import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalize, severity, type DiagnosticInput, type LogEvent } from '../src/diagnostics/contract.js'
import { DiagnosticRuntime } from '../src/diagnostics/runtime.js'
import { DiagnosticStore, DEFAULT_LOG_POLICY } from '../src/diagnostics/store.js'
import { callerDiagnostic, workspaceEnvelope } from '../src/diagnostics/sources.js'

const NOW = Date.parse('2026-10-18T10:00:00Z')
const alice = { workspace: 'alice', operator: false }
const operator = { workspace: 'alice', operator: true }
const stores: DiagnosticStore[] = []
const directories: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of directories.splice(0)) rmSync(dir, { force: true, recursive: true }) })
function directory() { const path = mkdtempSync(join(tmpdir(), 'poise-diagnostics-')); directories.push(path); return path }
function store(policy = DEFAULT_LOG_POLICY) { const value = new DiagnosticStore(':memory:', policy, () => NOW); stores.push(value); return value }
function event(id: string, update: Partial<DiagnosticInput> = {}): LogEvent {
  const value = normalize({ id, time: new Date(NOW).toISOString(), level: 'error', source: 'poise', operation: 'test.operation',
    workspace: 'alice', message: 'precise failure', ...update }, NOW)
  if (!value) throw new Error('Expected a qualifying fixture')
  return value
}

describe('one diagnostic contract', () => {
  it('maps native levels and refuses to silently omit malformed levels', () => {
    for (const level of ['fatal', 'Critical', '0', '2']) expect(severity(level)).toBe('critical')
    expect(severity('ERROR')).toBe('error'); expect(severity('warn')).toBe('warning')
    for (const level of ['info', 'debug', 'trace', '5', '6', '7']) expect(normalize({ source: 'native', operation: 'read', level, message: 'routine' })).toBeNull()
    expect(event('malformed', { level: 'banana' })).toMatchObject({ source: 'collection', severity: 'warning', operation: 'normalization.failed', sourceLevel: 'banana' })
  })

  it('redacts before persistence and omits prompts, stdout and environment recursively', () => {
    const secret = 'private-example-credential'
    const encoded = Buffer.from('x-access-token:' + secret).toString('base64')
    const value = normalize({ id: 'redaction', level: 'error', source: 'caller', operation: 'fetch', workspace: 'alice',
      message: secret, stderr: `Authorization: Basic ${encoded}\nCookie: private-cookie\nhttps://user:password@example.com/?token=private-query\n${encoded}`,
      context: { prompt: 'private-prompt', stdout: 'private-output', nested: { environment: 'private-env', safe: 'measured' } } }, NOW, [secret])!
    const db = store(); db.append([value])
    const output = JSON.stringify(db.query(alice))
    for (const denied of [secret, encoded, 'private-cookie', 'password', 'private-query', 'private-prompt', 'private-output', 'private-env']) expect(output).not.toContain(denied)
    expect(output).toContain('measured')
  })

  it('preserves occurrence identity while distinguishing workspace and technical scope', () => {
    expect(event('same').id).toBe(event('same').id)
    expect(event('same').id).not.toBe(event('same', { workspace: 'bob' }).id)
    expect(event('same').incidentId).not.toBe(event('same', { visibility: 'operator' }).incidentId)
    const db = store(); expect(db.append([event('same'), event('same')])).toBe(1)
    expect(() => db.append([event('same', { message: 'contradictory cause' })])).toThrow('Conflicting immutable')
    expect(db.query(alice).events[0]?.message).toBe('precise failure')
  })

  it('keeps the same scoped event ID when central collection re-redacts a workspace envelope', () => {
    const original = event('stream')
    const central = workspaceEnvelope(original, 'alice', NOW + 1000, [])
    expect(central.id).toBe(original.id); expect(central.ingestedAt).not.toBe(original.ingestedAt)
    expect(() => workspaceEnvelope(original, 'bob', NOW, [])).toThrow('scope')
    expect(() => workspaceEnvelope({ ...original, id: event('stream', { workspace: 'bob' }).id }, 'alice', NOW, [])).toThrow('scope')
  })
})

describe('retained authorized queries', () => {
  it('filters the full retained dataset and never accepts lower severities', () => {
    const db = store()
    db.append(Array.from({ length: 80 }, (_, i) => event(String(i), { level: i % 2 ? 'warning' : 'error', source: i === 70 ? 'caller' : 'poise', repository: 'acme/repo' })))
    expect(db.query(alice, { source: 'caller', limit: 1 }).total).toBe(1)
    expect(db.query(alice, { severities: ['warning'] }).total).toBe(40)
    expect(db.query(alice, { search: 'precise' }).total).toBe(80)
    expect(db.query(alice, { search: "' OR 1=1 --" }).total).toBe(0)
    expect(db.query(alice, { severities: [] }).total).toBe(0)
    expect(() => db.query(alice, { severities: ['info' as 'error'] })).toThrow('only Critical')
  })

  it('does not widen scope through filters, direct IDs or cursors', () => {
    const db = store(); const bob = event('bob', { workspace: 'bob' }); db.append([event('alice'), bob, event('host', { workspace: null })])
    expect(db.query(alice).events).toHaveLength(1)
    expect(db.query(operator).events).toHaveLength(2)
    expect(() => db.query(alice, { workspace: 'bob' })).toThrow('forbidden')
    expect(db.lookup(alice, bob.id).status).toBe('unavailable')
    expect(db.lookup(operator, bob.id).status).toBe('unavailable')
    expect(db.query(operator, { workspace: 'bob' }).total).toBe(0)
    const cursor = db.query(operator, { limit: 1 }).nextCursor!
    expect(() => db.query(alice, { cursor })).toThrow('filters')
  })

  it('paginates with stable ordering and a fixed ingestion boundary', () => {
    const db = store(); db.append(Array.from({ length: 12 }, (_, i) => event(String(i))))
    const first = db.query(alice, { limit: 5 })
    db.append([event('late', { time: new Date(NOW - 1).toISOString() })])
    const second = db.query(alice, { limit: 5, cursor: first.nextCursor! })
    const third = db.query(alice, { limit: 5, cursor: second.nextCursor! })
    const ids = [...first.events, ...second.events, ...third.events].map((row) => row.id)
    expect(new Set(ids).size).toBe(12); expect(third.nextCursor).toBeNull(); expect(second.total).toBe(12)
    expect(db.query(alice).total).toBe(13)
  })

  it('enforces retention and byte/count bounds without duplicate replay evicting history', () => {
    const db = store({ retentionMs: 1000, maxBytes: 100_000, maxEvents: 2 })
    const old = event('old', { time: new Date(NOW - 2000).toISOString() })
    db.append([old, event('one'), event('two')]); expect(db.query(alice).total).toBe(2)
    db.append([event('one')]); expect(db.query(alice).total).toBe(2)
    expect(db.lookup(alice, old.id).status).toBe('expired')
    db.append([event('three')]); expect(db.query(alice).total).toBe(2)
    expect(() => db.query(alice, { limit: 10000 })).toThrow('page size')
  })

  it('survives store restart and workspace deletion while preserving multiline cause as one event', () => {
    const path = join(directory(), 'history.db')
    const original = event('removed-container', { container: 'old-container', stderr: 'fatal: exact cause\nstack line one\nstack line two' })
    const first = new DiagnosticStore(path, DEFAULT_LOG_POLICY, () => NOW); first.append([original]); first.close()
    const second = new DiagnosticStore(path, DEFAULT_LOG_POLICY, () => NOW); stores.push(second)
    expect(second.query(alice).total).toBe(1)
    expect(second.lookup(alice, original.id)).toMatchObject({ status: 'found', event: { stderr: original.stderr, container: 'old-container' } })
  })
})

describe('collection independence and Caller evidence', () => {
  it('bounds buffering, exposes drops through an independent health path and recovers ingestion', () => {
    const root = directory(); const blocked = join(root, 'blocked'); writeFileSync(blocked, 'not a directory')
    let now = NOW
    const runtime = new DiagnosticRuntime({ path: join(blocked, 'history.db'), now: () => now, maxQueueEvents: 2, report: () => undefined })
    runtime.emit({ source: 'poise', operation: 'read', level: 'error', workspace: 'alice', message: 'first' })
    runtime.emit({ source: 'poise', operation: 'read', level: 'error', workspace: 'alice', message: 'second' })
    expect(runtime.emit({ source: 'poise', operation: 'read', level: 'error', workspace: 'alice', message: 'dropped' })).toBeNull()
    expect(() => runtime.flush()).not.toThrow()
    expect(runtime.health()).toMatchObject({ status: 'unavailable', queued: 2, dropped: 1 })
    rmSync(blocked); now += 6000; runtime.flush(); runtime.flush()
    expect(runtime.query((db) => db.query(alice)).total).toBe(2)
    expect(runtime.health().queued).toBe(0)
    runtime.stop()
  })

  it('turns source loss into visible coverage, independent of empty event results', () => {
    const db = store(); db.coverage({ id: 'kernel', source: 'kernel', workspace: null, status: 'unavailable', observedAt: null,
      ingestedAt: null, availableFrom: null, error: 'operator-private-path', gaps: [{ from: new Date(NOW).toISOString(), to: null, reason: 'operator-private-path' }] })
    const page = db.query(alice)
    expect(page.total).toBe(0); expect(page.coverage[0]?.status).toBe('unavailable')
    expect(JSON.stringify(page)).not.toContain('operator-private-path')
    expect(db.query(operator).coverage[0]?.error).toBe('operator-private-path')
  })

  it('retains exact Caller process evidence while omitting expected transitions and product successes', () => {
    const row = { id: 'a'.repeat(32), status: 'failed', repo: 'acme/repo', pr_id: '12', actor: 'bot', correlation_id: 'run',
      completed_at: new Date(NOW).toISOString(), diagnostic: { version: 1, severity: 'error', operation: 'fetch', phase: 'checkout',
        stderr: 'fatal: missing ref', context: { exit_code: 128, cwd: '/tmp/review' } }, error: 'Git fetch exited 128' }
    expect(callerDiagnostic(row, 'alice')).toMatchObject({ operation: 'fetch', stderr: 'fatal: missing ref', exitCode: 128, callId: row.id, correlationId: 'run' })
    expect(callerDiagnostic({ ...row, outcome: 'superseded' }, 'alice')).toBeNull()
    expect(callerDiagnostic({ ...row, error_code: 'stopped' }, 'alice')).toBeNull()
    expect(callerDiagnostic({ ...row, diagnostic: null, outcome: 'changes_requested' }, 'alice')).toBeNull()
  })
})
