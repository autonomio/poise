import { createHash, randomUUID } from 'node:crypto'

export const LOG_VERSION = 1
export const SEVERITIES = ['critical', 'error', 'warning'] as const
export type Severity = typeof SEVERITIES[number]
export type Facts = Record<string, unknown>
export interface DiagnosticInput {
  id?: string
  time?: string | null
  level: string | number
  source: string
  component?: string
  operation: string
  phase?: string | null
  target?: string | null
  message: string
  condition?: string
  workspace?: string | null
  instance?: string | null
  container?: string | null
  release?: string | null
  account?: string | null
  repository?: string | null
  pr?: string | number | null
  behavior?: string | null
  reviewer?: string | null
  callId?: string | null
  requestId?: string | null
  correlationId?: string | null
  cause?: string[]
  stderr?: string | null
  stack?: string | null
  truncated?: boolean
  exitCode?: number | null
  signal?: string | number | null
  timeoutMs?: number | null
  errno?: string | number | null
  context?: Facts
  resources?: Facts
  visibility?: 'workspace' | 'operator' | 'infrastructure'
}
export interface LogEvent {
  version: 1
  id: string
  incidentId: string
  eventTime: string | null
  ingestedAt: string
  severity: Severity
  sourceLevel: string
  source: string
  component: string
  operation: string
  phase: string | null
  target: string | null
  workspace: string | null
  instance: string | null
  container: string | null
  release: string | null
  account: string | null
  repository: string | null
  pr: string | null
  behavior: string | null
  reviewer: string | null
  callId: string | null
  requestId: string | null
  correlationId: string | null
  message: string
  cause: string[]
  stderr: string | null
  stack: string | null
  truncated: boolean
  exitCode: number | null
  signal: string | number | null
  timeoutMs: number | null
  errno: string | number | null
  context: Facts
  resources: Facts
  visibility: 'workspace' | 'operator' | 'infrastructure'
}

const PRIVATE_KEY = /^(?:prompt|prompts|content|body|responses?|stdout|argv|args|arguments|environment|env|messages|conversation|attachments|reasoning|inputs?|outputs?|payloads?|requests?)$/i
const SECRET_KEY = /authorization|cookie|password|secret|credential|(?:^|[_-])token$|^(?:access|refresh|id|auth|api|session)Token$|^auth$|^bearer$|api.?key|private.?key/i
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const scopePrefix = (workspace: string | null, visibility: string) => hash(JSON.stringify([workspace, visibility])).slice(0, 16)

export function redact(value: string, secrets: readonly string[] = []): string {
  for (const secret of [...secrets].filter((item) => item.length >= 8).sort((a, b) => b.length - a.length)) {
    for (const encoded of [secret, Buffer.from(secret).toString('base64'), Buffer.from(`x-access-token:${secret}`).toString('base64')]) value = value.split(encoded).join('[redacted]')
  }
  return value.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, '[redacted header]')
    .replace(/\b(?:Basic|Bearer|token)\s+[^\s,;"']+/gi, '[redacted credential]')
    .replace(/(https?:\/\/)[^\s/]+@/g, '$1[redacted]@')
    .replace(/([?&](?:token|key|secret|password|auth|signature)=)[^\s&#]+/gi, '$1[redacted]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

export function environmentSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env).flatMap(([key, value]) => SECRET_KEY.test(key) || /TOKEN|KEY|AUTH/i.test(key) ? value && value.length >= 8 ? [value] : [] : [])
}

export function severity(level: string | number): Severity | null | 'invalid' {
  const value = String(level).toLowerCase()
  if (['fatal', 'critical', 'crit', 'emerg', 'alert', 'panic', '0', '1', '2'].includes(value)) return 'critical'
  if (['error', 'err', '3'].includes(value)) return 'error'
  if (['warning', 'warn', '4'].includes(value)) return 'warning'
  if (['notice', 'info', 'information', 'debug', 'trace', '5', '6', '7'].includes(value)) return null
  return 'invalid'
}

function safeFacts(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (value == null || typeof value === 'boolean') return value ?? null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return redact(value, secrets).slice(0, 1024)
  if (depth >= 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => safeFacts(item, secrets, depth + 1))
  if (typeof value !== 'object') return '[unsupported value]'
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEY.test(key)).slice(0, 32)
    .map(([key, item]) => [redact(key, secrets).slice(0, 64), SECRET_KEY.test(key) ? '[redacted]' : safeFacts(item, secrets, depth + 1)]))
}

function facts(value: Facts | undefined, secrets: readonly string[]): Facts {
  const safe = safeFacts(value ?? {}, secrets) as Facts
  return Buffer.byteLength(JSON.stringify(safe)) <= 8192 ? safe : { truncated: true, reason: 'Context exceeds 8 KiB' }
}

export function normalize(input: DiagnosticInput, now = Date.now(), secrets: readonly string[] = []): LogEvent | null {
  const level = severity(input.level)
  if (level === null) return null
  if (!input.source || !input.operation || typeof input.message !== 'string') throw new Error('Diagnostic needs source, operation and message')
  let truncated = !!input.truncated || (input.cause?.length ?? 0) > 8
  const clean = (value: string, limit = 512) => {
    const bytes = Buffer.from(redact(value, secrets))
    if (bytes.length <= limit) return bytes.toString()
    truncated = true
    let end = limit
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
    return bytes.subarray(0, end).toString()
  }
  const nullable = (value: string | number | null | undefined) => value == null ? null : clean(String(value))
  const number = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value : null
  const time = input.time == null ? null : Date.parse(input.time)
  const invalidTime = time !== null && (!Number.isFinite(time) || time < 0)
  const ingestedAt = new Date(now).toISOString()
  const eventTime = time === null || invalidTime ? null : new Date(time).toISOString()
  const message = level === 'invalid' || invalidTime
    ? `Collection could not normalize ${clean(input.source)}: ${level === 'invalid' ? 'unknown source severity' : 'invalid source timestamp'}. ${clean(input.message, 1024)}` : clean(input.message, 2048)
  const source = level === 'invalid' || invalidTime ? 'collection' : clean(input.source, 128)
  const operation = level === 'invalid' || invalidTime ? 'normalization.failed' : clean(input.operation, 128)
  const workspace = nullable(input.workspace)
  const visibility = input.visibility ?? (workspace ? 'workspace' : 'operator')
  if (!['workspace', 'operator', 'infrastructure'].includes(visibility)) throw new Error('Invalid diagnostic visibility')
  if (visibility === 'workspace' && !workspace) throw new Error('Workspace diagnostics require a workspace identity')
  const prefix = scopePrefix(workspace, visibility)
  const incidentId = 'inc_' + prefix + '_' + hash(JSON.stringify([workspace, visibility, source, operation, input.account ?? null,
    input.repository ?? null, input.target ?? null, input.behavior ?? null, clean(input.condition ?? message)]))
  const id = 'evt_' + prefix + '_' + hash(JSON.stringify([workspace, source, input.id ?? randomUUID()]))
  const stderr = input.stderr == null ? null : clean(input.stderr, 16_384)
  const stack = input.stack == null ? null : clean(input.stack, 8192)
  return {
    version: LOG_VERSION, id, incidentId, eventTime, ingestedAt,
    severity: level === 'invalid' || invalidTime ? 'warning' : level, sourceLevel: clean(String(input.level), 64), source,
    component: clean(input.component ?? input.source, 128), operation, phase: nullable(input.phase), target: nullable(input.target),
    workspace, visibility, instance: nullable(input.instance), container: nullable(input.container), release: nullable(input.release),
    account: nullable(input.account), repository: nullable(input.repository), pr: nullable(input.pr), behavior: nullable(input.behavior),
    reviewer: nullable(input.reviewer), callId: nullable(input.callId), requestId: nullable(input.requestId), correlationId: nullable(input.correlationId),
    message, cause: (input.cause ?? []).slice(0, 8).map((cause) => clean(cause, 512)), stderr, stack,
    truncated,
    exitCode: number(input.exitCode), signal: typeof input.signal === 'number' ? number(input.signal) : nullable(input.signal),
    timeoutMs: number(input.timeoutMs), errno: typeof input.errno === 'number' ? number(input.errno) : nullable(input.errno),
    context: level === 'invalid' || invalidTime ? { source: clean(input.source), originalOperation: clean(input.operation) } : facts(input.context, secrets),
    resources: facts(input.resources, secrets),
  }
}
