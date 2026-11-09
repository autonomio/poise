import { sign, verify, type KeyObject } from 'node:crypto'

export const MCP_READ_PATH = '/api/mcp/read'
export const MCP_SCOPE = 'poise:read'
export const MCP_RESPONSE_BYTES = 128 * 1024
export const MCP_TOOLS = [
  { name: 'poise_describe', description: 'Describe this Poise workspace, release, read grant, sources and work-trail links.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'poise_work', description: 'Trace an exact issue, or one bounded repository/label page, through native work and merge evidence. Missing evidence under incomplete coverage is unknown.',
    inputSchema: { type: 'object', properties: {
      repository: { type: 'string', description: 'GitHub owner/repository in this workspace.' },
      issue: { type: 'integer', minimum: 1 }, label: { type: 'string', minLength: 1, maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 10 }, cursor: { type: 'string', maxLength: 2048 },
    }, required: ['repository'], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
] as const

export interface McpGrantScope { resource: string; ownerId: number; handle: string; grantId: string }
export interface WorkRead { repository: string; issue?: number; label?: string; limit: number; cursor?: string }
export interface WorkPosition { repository: string; number: number }
export type McpRead = { name: 'poise_describe'; arguments: Record<string, never> } | { name: 'poise_work'; arguments: WorkRead }

export function parseMcpRead(value: unknown): McpRead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid tool request')
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !['name', 'arguments'].includes(key))) throw new Error('unsupported tool request field')
  const args = row.arguments ?? {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object')
  const input = args as Record<string, unknown>
  if (row.name === 'poise_describe' && !Object.keys(input).length) return { name: row.name, arguments: {} }
  if (row.name !== 'poise_work') throw new Error('unsupported tool')
  if (Object.keys(input).some(key => !['repository', 'issue', 'label', 'limit', 'cursor'].includes(key))
    || typeof input.repository !== 'string' || input.repository.length > 140
    || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]+$/.test(input.repository)
    || (input.issue !== undefined && (!Number.isSafeInteger(input.issue) || Number(input.issue) < 1))
    || (input.label !== undefined && (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 100))
    || (input.issue === undefined && input.label === undefined)
    || (input.issue !== undefined && (input.label !== undefined || input.cursor !== undefined))
    || (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 10))
    || (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 2048))) throw new Error('use an exact issue or a repository/label page with limit 1–10')
  return { name: 'poise_work', arguments: { repository: input.repository.toLowerCase(), limit: Number(input.limit ?? 10),
    ...(typeof input.issue === 'number' ? { issue: input.issue } : {}),
    ...(typeof input.label === 'string' ? { label: input.label } : {}),
    ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}) } }
}

function cursorScope(scope: McpGrantScope, read: WorkRead): string {
  return JSON.stringify([scope.resource, scope.ownerId, scope.handle, scope.grantId, read.repository, read.label, read.limit])
}

export function signWorkCursor(key: KeyObject, scope: McpGrantScope, read: WorkRead, after: WorkPosition): string {
  const payload = Buffer.from(JSON.stringify({ scope: cursorScope(scope, read), after })).toString('base64url')
  return `${payload}.${sign(null, Buffer.from(payload), key).toString('base64url')}`
}

export function readWorkCursor(key: KeyObject, scope: McpGrantScope, read: WorkRead): WorkPosition {
  if (!read.cursor) return { repository: '', number: 0 }
  const [payload, signature, extra] = read.cursor.split('.')
  if (!payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)
    || Buffer.from(signature, 'base64url').toString('base64url') !== signature
    || !verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64url'))) throw new Error('invalid work cursor')
  const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!value || typeof value !== 'object' || !('scope' in value) || value.scope !== cursorScope(scope, read)
    || !('after' in value) || !value.after || typeof value.after !== 'object'
    || !('repository' in value.after) || typeof value.after.repository !== 'string' || value.after.repository.toLowerCase() !== read.repository
    || !('number' in value.after) || !Number.isSafeInteger(value.after.number) || Number(value.after.number) < 1) throw new Error('work cursor is outside this grant or query')
  return { repository: value.after.repository, number: Number(value.after.number) }
}
