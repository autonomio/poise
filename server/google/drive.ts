import { randomUUID } from 'node:crypto'
import { googleAccessToken } from './accounts'
import { HttpError } from '../http'

const MAX_BYTES = 10 * 1024 * 1024
export interface GoogleFile { id: string, name: string, mimeType: string, trashed?: boolean }
export async function driveRequest(accountId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await googleAccessToken(accountId)
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) {
    const status = response.status === 412 ? 409 : response.status === 404 ? 404 : 502
    throw new HttpError(status, response.status === 412 ? 'Google changed during publishing. Review the latest version and try again.' : response.status === 404 ? 'This Google file is missing or this account no longer has access.' : response.status === 401 || response.status === 403 ? 'Google access was rejected. Reconnect the account and check file permissions.' : `Google Drive answered ${response.status}; no automatic retry was made.`)
  }
  return response
}
async function metadata(accountId: string, id: string) {
  const response = await driveRequest(accountId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`)
  const file = await response.json() as GoogleFile
  if (file.id !== id || file.mimeType !== 'text/markdown' || file.trashed) throw new HttpError(422, 'The linked Google file must be an available Markdown file.')
  const etag = response.headers.get('etag')
  if (!etag || !/^"[^"\r\n]+"$/.test(etag)) throw new HttpError(502, 'Google returned no usable strong write precondition; publishing is refused.')
  return { file, etag }
}
export async function readGoogleFile(accountId: string, id: string): Promise<{ raw: string, etag: string, file: GoogleFile }> {
  const { file, etag } = await metadata(accountId, id)
  const response = await driveRequest(accountId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { 'If-Match': etag } })
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new HttpError(422, 'The Google Markdown file exceeds 10 MB.')
  if (!response.body) throw new HttpError(502, 'Google returned no file content.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError(422, 'The Google Markdown file exceeds 10 MB.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return { raw: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), etag, file }
}
export async function googleFileId(accountId: string): Promise<string> {
  const response = await driveRequest(accountId, 'https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files')
  const data = await response.json() as { ids?: string[] }
  if (!data.ids?.[0] || !/^[A-Za-z0-9_-]+$/.test(data.ids[0])) throw new HttpError(502, 'Google returned no file ID.')
  return data.ids[0]
}
export async function createGoogleFile(accountId: string, id: string, name: string, raw: string): Promise<void> {
  const boundary = `poise_${randomUUID()}`
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ id, name, mimeType: 'text/markdown' })}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${raw}\r\n--${boundary}--\r\n`
  await driveRequest(accountId, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
}
export async function updateGoogleFile(accountId: string, id: string, raw: string, etag: string): Promise<void> {
  if (!etag || !/^"[^"\r\n]+"$/.test(etag)) throw new HttpError(428, 'A strong Google write precondition is required.')
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new HttpError(422, 'The Google Markdown file exceeds 10 MB.')
  await driveRequest(accountId, `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id&supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': 'text/markdown; charset=UTF-8', 'If-Match': etag }, body: raw })
}
