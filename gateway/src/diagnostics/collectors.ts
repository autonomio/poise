import { createHash } from 'node:crypto'
import type { ContainerSummary, DockerClient } from '../docker.js'
import type { Context } from '../context.js'
import { signAssertion } from '../assertion.js'
import http from 'node:http'
import { normalize, type DiagnosticInput, type LogEvent } from './contract.js'
import { DiagnosticRuntime } from './runtime.js'
import { nativeDiagnostic, workspaceEnvelope } from './sources.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const handle = (value: string | undefined) => value && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value) ? value : null
export const diagnosticOwner = (labels: Record<string, string>) =>
  labels['poise.managed'] === 'true' || labels['poise.task'] === 'install-release' ? handle(labels['poise.workspace']) : null
export const diagnosticManaged = (labels: Record<string, string>) => diagnosticOwner(labels) !== null || labels['com.docker.compose.project'] === 'poise'

/** Only an allow-listed technical projection can cross the infrastructure boundary. */
export function gatewayDiagnostic(level: string, operation: string, fields: Record<string, unknown>): DiagnosticInput {
  const workspace = typeof fields.handle === 'string' ? handle(fields.handle) : null
  const shared = /^(?:proxy\.|workspace\.(?:unreachable|start|stop|drain|update)|disk\.)/.test(operation)
  const context = Object.fromEntries(['method', 'route', 'upstream', 'durationMs', 'requestId', 'container', 'release', 'limit', 'free', 'total', 'errno', 'code', 'disconnect']
    .map((key) => [key, fields[key] ?? null]))
  const cause = typeof fields.error === 'string' ? fields.error.replace(/\/(?:home|Users)\/[^\s:'"<>]+/g, '[private path]').replace(/https?:\/\/[^\s]+/g, '[upstream URL]') : null
  return { source: 'gateway', level, operation, workspace: shared ? workspace : null, visibility: shared && workspace ? 'infrastructure' : 'operator',
    message: cause ? `${operation}: ${cause}` : operation, context: shared ? context : { ...context, causeUnavailable: cause === null },
    requestId: typeof fields.requestId === 'string' ? fields.requestId : null }
}

/** Docker multiplex framing and line bounds are enforced before JSON parsing. */
export function dockerLines(bytes: Buffer): string[] {
  const chunks: Buffer[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) throw new Error('Truncated Docker log frame')
    const size = bytes.readUInt32BE(offset + 4)
    if (bytes[offset] > 2 || bytes[offset + 1] || bytes[offset + 2] || bytes[offset + 3] || size > 2 * 1024 * 1024 || offset + 8 + size > bytes.length) throw new Error('Invalid Docker log frame')
    chunks.push(bytes.subarray(offset + 8, offset + 8 + size)); offset += 8 + size
  }
  const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean)
  if (lines.length > 1000 || lines.some((line) => Buffer.byteLength(line) > 64 * 1024)) throw new Error('Docker log line/count bound exceeded; collection gap')
  return lines
}

export function dockerLifecycle(value: unknown): DiagnosticInput | null {
  if (!value || typeof value !== 'object') throw new Error('Malformed Docker lifecycle event')
  const row = value as { Type?: string; Action?: string; Actor?: { ID?: string; Attributes?: Record<string, string> }; timeNano?: number; time?: number }
  const labels = row.Actor?.Attributes ?? {}
  if (row.Type !== 'container' || !diagnosticManaged(labels)) return null
  const action = row.Action ?? ''
  const exitCode = labels.exitCode === undefined || !/^-?\d+$/.test(labels.exitCode) ? null : Number(labels.exitCode)
  const level = action === 'oom' ? 'critical' : action === 'die' && exitCode !== null && Number.isFinite(exitCode) && exitCode !== 0 ? 'error' : action === 'health_status: unhealthy' ? 'warning' : null
  if (!level) return null
  const workspace = diagnosticOwner(labels)
  const time = typeof row.time === 'number' && Number.isFinite(row.time) && row.time >= 0 && row.time < 8.64e12 ? new Date(row.time * 1000).toISOString() : null
  return { id: hash(JSON.stringify([row.Actor?.ID, action, row.timeNano ?? row.time])), time, source: 'docker', operation: 'container.' + action,
    level, workspace, visibility: workspace ? 'infrastructure' : 'operator', container: row.Actor?.ID ?? null,
    message: action === 'oom' ? 'Docker reported a container OOM kill' : action === 'die' ? `Container exited with code ${exitCode}` : 'Docker reported an unhealthy container',
    exitCode: Number.isFinite(exitCode) ? exitCode : null, resources: { oomKilled: action === 'oom', memoryLimitBytes: null, cpuLimit: null, pidsLimit: null } }
}

export class EnvironmentCollectors {
  private timer: ReturnType<typeof setInterval> | null = null
  private pass: Promise<void> | null = null
  private stopping = false
  constructor(private readonly runtime: DiagnosticRuntime, private readonly docker: DockerClient, private readonly context: Context) {}

  start(): void {
    if (this.timer) return
    this.stopping = false
    const run = () => { if (!this.pass) this.pass = this.collect().finally(() => { this.pass = null }) }
    this.timer = setInterval(run, 15_000); this.timer.unref(); run()
  }
  async stop(): Promise<void> { this.stopping = true; if (this.timer) clearInterval(this.timer); this.timer = null; await this.pass }

  private async collect(): Promise<void> {
    const until = Math.floor(Date.now() / 1000) - 1
    try {
      const containers = await this.docker.diagnosticContainers()
      if (containers.length > 128) throw new Error('Docker collection exceeds 128 source containers; remaining coverage is unavailable')
      for (const container of containers) {
        if (this.stopping) return
        await this.logs(container, until)
      }
      await this.events(until)
      this.runtime.observe('docker', 'docker', null)
    } catch (error) { this.runtime.observe('docker', 'docker', null, String(error)) }
    for (const user of this.context.deps.store.listUsers()) {
      if (this.stopping) return
      if (user.disabledAt === null) await this.workspace(user.handle, user.login)
    }
  }

  private async logs(container: ContainerSummary, until: number): Promise<void> {
    if (!diagnosticManaged(container.Labels) || container.Labels['com.docker.compose.service'] === 'gateway') return
    const workspace = diagnosticOwner(container.Labels)
    const key = 'docker-log:' + container.Id
    const coverage = workspace ? 'workspace-stream:' + workspace : 'ingress'
    try {
      const previous = this.runtime.query((db) => db.checkpoint(key))
      const since = previous ? Number(previous) : until - 60
      const bytes = await this.docker.diagnosticRead(`/containers/${encodeURIComponent(container.Id)}/logs?stdout=1&stderr=1&timestamps=1&since=${since}&until=${until}&tail=1000`)
      const events: LogEvent[] = []
      let excluded = 0
      const lines = dockerLines(bytes)
      if (lines.length >= 1000) throw new Error('Docker log tail bound reached; earlier records may be missing')
      for (const line of lines) {
        const content = line.slice(line.indexOf(' ') + 1)
        let row: unknown
        try { row = JSON.parse(content) } catch { excluded++; continue }
        const envelope = row && typeof row === 'object' && 'poiseDiagnostic' in row ? row.poiseDiagnostic : null
        if (workspace && envelope) events.push(workspaceEnvelope(envelope, workspace, Date.now(), []))
        else if (container.Labels['com.docker.compose.service'] === 'caddy') {
          const input = nativeDiagnostic(row, 'ingress', container.Id + ':' + hash(line), null)
          // Never copy HTTP request headers, query strings, payloads or arbitrary route IDs.
          input.context = { container: container.Id, originalSource: 'caddy' }
          const event = normalize(input)
          if (event) events.push(event)
        } else excluded++
      }
      for (let i = 0; i < events.length; i += 100) this.runtime.query((db) => db.append(events.slice(i, i + 100)))
      this.runtime.query((db) => db.commitDelivery([], key, String(until)))
      this.runtime.observe(coverage, workspace ? 'poise' : 'ingress', workspace, excluded ? 'Unstructured source output excluded to protect user content; structured diagnostic coverage only' : null)
    } catch (error) { this.runtime.observe(coverage, workspace ? 'poise' : 'ingress', workspace, String(error)) }
  }

  private async events(until: number): Promise<void> {
    const key = 'docker-events'
    try {
      const previous = this.runtime.query((db) => db.checkpoint(key))
      const since = previous ? Number(previous) : until - 60
      const bytes = await this.docker.diagnosticRead(`/events?since=${since}&until=${until}`, 512 * 1024)
      const lines = bytes.toString().split('\n').filter(Boolean)
      if (lines.length > 2000) throw new Error('Docker lifecycle event bound exceeded; coverage gap')
      const events = lines.flatMap((line) => {
        const input = dockerLifecycle(JSON.parse(line)); const event = input && normalize(input)
        return event ? [event] : []
      })
      for (let i = 0; i < events.length; i += 100) this.runtime.query((db) => db.append(events.slice(i, i + 100)))
      this.runtime.query((db) => db.commitDelivery([], key, String(until)))
      this.runtime.observe('docker-events', 'docker', null)
    } catch (error) { this.runtime.observe('docker-events', 'docker', null, String(error)) }
  }

  private async workspace(handle: string, login: string): Promise<void> {
    const key = 'workspace:' + handle
    try {
      const cursor = this.runtime.query((db) => db.checkpoint(key))
      const target = this.context.deps.upstream(handle)
      const { config, keys, now } = this.context.deps
      const path = '/api/service/diagnostics' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')
      const page = await new Promise<{ version: number; events: unknown[]; cursor: string; coverage: { status: string } }>((resolve, reject) => {
        const req = http.get({ host: target.host, port: target.port, path, agent: false, headers: {
          host: `${handle}.${config.domain}`, 'x-poise-identity': signAssertion(keys.privateKey, { handle, login, scope: 'admin' }, now()),
        } }, (res) => {
          let size = 0; const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 256 * 1024) req.destroy(new Error('Workspace diagnostic delivery exceeds 256 KiB')); else chunks.push(chunk) })
          res.on('error', reject)
          res.on('end', () => {
            try { if (res.statusCode !== 200) throw new Error(`Workspace diagnostic source answered HTTP ${res.statusCode}`); resolve(JSON.parse(Buffer.concat(chunks).toString())) }
            catch (error) { reject(error) }
          })
        })
        req.setTimeout(5000, () => req.destroy(new Error('Workspace diagnostic source timed out'))); req.on('error', reject)
      })
      if (page.version !== 1 || !Array.isArray(page.events) || page.events.length > 3 || typeof page.cursor !== 'string' || !page.coverage || typeof page.coverage.status !== 'string') throw new Error('Workspace diagnostic delivery is incompatible')
      const events = page.events.map((event) => workspaceEnvelope(event, handle, Date.now(), []))
      this.runtime.query((db) => db.commitDelivery(events, key, page.cursor))
      this.runtime.observe(key, 'poise', handle, page.coverage.status === 'connected' && !('hasMore' in page && page.hasMore) ? null : 'Workspace reports partial or unavailable diagnostic collection')
    } catch (error) { this.runtime.observe(key, 'poise', handle, String(error)) }
  }
}
