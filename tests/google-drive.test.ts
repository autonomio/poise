import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const credentials = vi.hoisted(() => vi.fn())
vi.mock('../server/google/accounts', () => ({ googleAccessToken: credentials }))
import { readGoogleFile, updateGoogleFile } from '../server/google/drive'
const fake = vi.fn<typeof fetch>()
beforeEach(() => { fake.mockReset(); credentials.mockResolvedValue('private-access'); vi.stubGlobal('fetch', fake) })
afterEach(() => vi.unstubAllGlobals())
describe('Google Drive conditional content access', () => {
  it('reads metadata and media under the same revision and pins updates with If-Match', async () => {
    fake.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file', name: 'Draft.md', mimeType: 'text/markdown' }), { headers: { etag: '"rev-one"' } })).mockResolvedValueOnce(new Response('# Draft')).mockResolvedValueOnce(new Response('{}'))
    const file = await readGoogleFile('account-one', 'file')
    expect(file.raw).toBe('# Draft')
    expect(fake.mock.calls[1][1]?.headers).toMatchObject({ 'If-Match': '"rev-one"', Authorization: 'Bearer private-access' })
    await updateGoogleFile('account-one', 'file', '# Updated draft', file.etag)
    expect(fake.mock.calls[2][1]).toMatchObject({ method: 'PATCH', body: '# Updated draft', headers: { 'If-Match': '"rev-one"' } })
    expect(credentials.mock.calls.every(call => call[0] === 'account-one')).toBe(true)
  })
  it('fails closed when a write precondition is missing or Google rejects it', async () => {
    fake.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file', mimeType: 'text/markdown' })))
    await expect(readGoogleFile('one', 'file')).rejects.toThrow('no write precondition')
    await expect(updateGoogleFile('one', 'file', 'new', '')).rejects.toThrow('precondition is required')
    fake.mockResolvedValueOnce(new Response('{}', { status: 412 }))
    await expect(updateGoogleFile('one', 'file', 'new', '"old"')).rejects.toThrow('changed during publishing')
    expect(fake).toHaveBeenCalledTimes(2)
  })
  it('rejects native rich Google Docs, trashed files and invalid UTF-8', async () => {
    fake.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file', mimeType: 'application/vnd.google-apps.document' }), { headers: { etag: '"rev"' } }))
    await expect(readGoogleFile('one', 'file')).rejects.toThrow('Markdown')
    fake.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file', mimeType: 'text/markdown', trashed: true }), { headers: { etag: '"rev"' } }))
    await expect(readGoogleFile('one', 'file')).rejects.toThrow('available')
    fake.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file', mimeType: 'text/markdown' }), { headers: { etag: '"rev"' } })).mockResolvedValueOnce(new Response(new Uint8Array([255])))
    await expect(readGoogleFile('one', 'file')).rejects.toThrow()
  })
})
