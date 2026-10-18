import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalize, severity, type DiagnosticInput, type LogEvent } from '../src/diagnostics/contract.js'
import { DiagnosticRuntime } from '../src/diagnostics/runtime.js'
import { DiagnosticStore, DEFAULT_LOG_POLICY } from '../src/diagnostics/store.js'
import { callerDiagnostic, nativeDiagnostic, workspaceEnvelope } from '../src/diagnostics/sources.js'

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
  it('keeps unknown-time identity independent of ingestion time and replacement containers', () => {
    const input = { id: 'stable-native-id', time: null, level: 'error', source: 'native', operation: 'read', message: 'cause' }
    expect(normalize(input, NOW)?.id).toBe(normalize({ ...input, container: 'replacement' }, NOW + 5000)?.id)
    expect(event('pre-epoch', { time: '1960-01-01T00:00:00Z' })).toMatchObject({ source: 'collection', severity: 'warning', eventTime: null })
  })

  it('validates full event and incident identities at storage and stream boundaries', () => {
    const original = event('invalid-id'); const db = store()
    for (const update of [{ id: original.id + 'suffix' }, { incidentId: original.incidentId + 'suffix' }]) {
      expect(() => db.append([{ ...original, ...update }])).toThrow('scope')
      expect(() => workspaceEnvelope({ ...original, ...update }, 'alice', NOW, [])).toThrow('scope')
    }
  })

  it('preserves native numeric priorities and diagnoses malformed timestamps without throwing', () => {
    const malformed = nativeDiagnostic({ PRIORITY: 3, __REALTIME_TIMESTAMP: 'not-a-clock', MESSAGE: 'original cause' }, 'kernel', 'journal-id', null)
    expect(() => normalize(malformed, NOW)).not.toThrow()
    expect(normalize(malformed, NOW)).toMatchObject({ severity: 'warning', source: 'collection', message: expect.stringContaining('original cause') })
    const attributed = normalize(nativeDiagnostic({ PRIORITY: 3, MESSAGE: 'kernel cause' }, 'kernel', 'journal-2', 'bob'), NOW)!
    const db = store(); db.append([attributed])
    expect(db.query(operator).total).toBe(1); expect(db.query(alice).total).toBe(0)
    expect(normalize(nativeDiagnostic({ level: 'error', ts: NOW / 1000, msg: 'proxy cause' }, 'ingress', 'request', null), NOW)?.eventTime).toBe(new Date(NOW).toISOString())
  })
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
      context: { prompt: 'private-prompt', stdout: 'private-output', arguments: ['private-argument'], responses: { text: 'private-response' }, token: 'opaque-token-value', refresh_token: 'opaque-refresh-value', nested: { environment: 'private-env', safe: 'measured' } } }, NOW, [secret])!
    const db = store(); db.append([value])
    const output = JSON.stringify(db.query(alice))
    for (const denied of [secret, encoded, 'private-cookie', 'password', 'private-query', 'private-prompt', 'private-output', 'private-env', 'private-argument', 'private-response', 'opaque-token-value', 'opaque-refresh-value']) expect(output).not.toContain(denied)
    expect(output).toContain('measured')
  })

  it('bounds UTF-8 evidence by bytes rather than characters', () => {
    const value = event('unicode', { stderr: '障'.repeat(20_000), stack: '障'.repeat(10_000) })
    expect(Buffer.byteLength(value.stderr!)).toBeLessThanOrEqual(16_384)
    expect(Buffer.byteLength(value.stack!)).toBeLessThanOrEqual(8192)
    expect(value.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(64 * 1024)
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
  it('bounds actual bytes and never resurrects a tombstoned replay', () => {
    const policy = { retentionMs: 100_000, maxBytes: 20_000, maxEvents: 100 }
    const db = store(policy)
    const records = Array.from({ length: 8 }, (_, i) => event('large-' + i, { stderr: 's'.repeat(12_000) }))
    for (const record of records) db.append([record])
    expect(db.query(alice).total).toBe(1)
    expect(db.lookup(alice, records[0].id).status).toBe('expired')
    db.append([records[0]])
    expect(db.query(alice).events.map((record) => record.id)).toEqual([records.at(-1)!.id])
  })

  it('ages out ingestion even when source timestamps are far in the future', () => {
    const policy = { retentionMs: 1000, maxBytes: 100_000, maxEvents: 100 }
    const db = store(policy)
    const future = { ...event('future', { time: '2099-01-01T00:00:00Z' }), ingestedAt: new Date(NOW - 2000).toISOString() }
    db.append([future]); expect(db.lookup(alice, future.id).status).toBe('expired')
    expect(db.query(alice).total).toBe(0)
  })
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
    expect(db.query(alice, { after: first.watermark }).events.map((row) => row.id)).toEqual([event('late', { time: new Date(NOW - 1).toISOString() }).id])
    expect(() => db.query(alice, { cursor: first.nextCursor!.slice(0, -3) + 'xyz' })).toThrow('cursor')
    expect(() => db.query({ workspace: 'bob', operator: false }, { after: first.watermark })).toThrow('cursor')
    expect(Buffer.from(first.nextCursor!, 'base64url').toString()).not.toContain('high')
  })

  it('enforces retention and byte/count bounds without duplicate replay evicting history', () => {
    const db = store({ retentionMs: 1000, maxBytes: 100_000, maxEvents: 2 })
    const old = { ...event('old', { time: new Date(NOW - 2000).toISOString() }), ingestedAt: new Date(NOW - 2000).toISOString() }
    db.append([old, event('one'), event('two')]); expect(db.query(alice).total).toBe(2)
    db.append([event('one')]); expect(db.query(alice).total).toBe(2)
    expect(db.lookup(alice, old.id).status).toBe('expired')
    db.append([event('three')]); expect(db.query(alice).total).toBe(2)
    expect(() => db.query(alice, { limit: 10000 })).toThrow('page size')
  })

  it('survives store restart while preserving multiline cause as one event', () => {
    const path = join(directory(), 'history.db')
    const original = event('removed-container', { container: 'old-container', stderr: 'fatal: exact cause\nstack line one\nstack line two' })
    const first = new DiagnosticStore(path, DEFAULT_LOG_POLICY, () => NOW); first.append([original]); first.close()
    const second = new DiagnosticStore(path, DEFAULT_LOG_POLICY, () => NOW); stores.push(second)
    expect(second.query(alice).total).toBe(1)
    expect(second.lookup(alice, original.id)).toMatchObject({ status: 'found', event: { stderr: original.stderr, container: 'old-container' } })
  })
})

describe('collection independence and Caller evidence', () => {
  it('drains more than one batch on shutdown and does not double count loss on restart', () => {
    const path = join(directory(), 'drain.db')
    const runtime = new DiagnosticRuntime({ path, now: () => NOW })
    for (let i = 0; i < 350; i++) runtime.emit({ id: String(i), time: null, level: 'error', source: 'poise', operation: 'read', workspace: 'alice', message: 'cause' })
    runtime.stop()
    const db = new DiagnosticStore(path, DEFAULT_LOG_POLICY, () => NOW); stores.push(db)
    expect(db.query(alice).total).toBe(350)
    const reopened = new DiagnosticRuntime({ path, now: () => NOW }); expect(reopened.health()).toMatchObject({ dropped: 0, queued: 0 }); reopened.stop()
  })

  it('separates query validation, coverage failure and reporter failure from sink availability', () => {
    const runtime = new DiagnosticRuntime({ path: ':memory:', now: () => NOW, report: () => { throw new Error('reporter broken') } })
    expect(() => runtime.query((db) => db.query(alice, { limit: 1000 }))).toThrow('page size')
    expect(runtime.health().error).toBeNull()
    const writeCoverage = vi.spyOn(DiagnosticStore.prototype, 'coverage').mockImplementation(() => { throw new Error('coverage only') })
    try {
      runtime.observe('source', 'poise', 'alice')
      runtime.emit({ id: 'coverage-failure', time: null, source: 'poise', operation: 'read', level: 'error', workspace: 'alice', message: 'cause' })
      expect(() => runtime.flush()).not.toThrow()
      expect(runtime.health()).toMatchObject({ error: null, queued: 0, coverageError: 'coverage only', reportError: 'reporter broken' })
      expect(runtime.query((db) => db.query(alice)).total).toBe(1)
    } finally { writeCoverage.mockRestore(); runtime.stop() }
  })

  it('quarantines poison input and preserves the first contradictory queued delivery', () => {
    const runtime = new DiagnosticRuntime({ path: ':memory:', now: () => NOW, policy: { ...DEFAULT_LOG_POLICY, maxBytes: 20_000 }, report: () => undefined })
    const input = { id: 'queued', time: null, source: 'poise', operation: 'read', level: 'error', workspace: 'alice', message: 'original' }
    runtime.emit(input); runtime.emit({ ...input, message: 'contradiction' })
    runtime.emit({ ...input, id: 'oversized', stderr: 'large'.repeat(5000), stack: 'stack'.repeat(3000) })
    runtime.emit({ ...input, id: 'valid-later', message: 'later cause' })
    for (let i = 0; i < 5; i++) runtime.flush()
    const records = runtime.query((db) => db.query(alice)).events
    expect(records.some((record) => record.message === 'later cause')).toBe(true)
    expect(records.some((record) => record.message === 'original')).toBe(true)
    expect(records.some((record) => record.message === 'contradiction')).toBe(false)
    expect(runtime.health()).toMatchObject({ error: null, queued: 0, rejected: 2 })
    runtime.stop()
  })

  it('retains prior drop evidence and closes open outages after an unclean restart', () => {
    const path = join(directory(), 'coverage.db'); let now = NOW
    const runtime = new DiagnosticRuntime({ path, now: () => now, maxQueueEvents: 1, report: () => undefined })
    runtime.observe('kernel', 'kernel', null, 'a'.repeat(2048))
    runtime.emit({ source: 'poise', operation: 'read', level: 'error', message: 'dropped' })
    now += 1000; runtime.flush()
    const restarted = new DiagnosticRuntime({ path, now: () => now, report: () => undefined })
    expect(restarted.health()).toMatchObject({ status: 'partial', dropped: 1, droppedSince: new Date(NOW).toISOString() })
    restarted.observe('kernel', 'kernel', null)
    expect(restarted.health().sources[0].gaps.every((gap) => gap.to !== null)).toBe(true)
    restarted.stop(); runtime.stop()
  })

  it('bounds repeated long source gaps and distinguishes same-clock transitions', () => {
    const runtime = new DiagnosticRuntime({ path: ':memory:', now: () => NOW, report: () => undefined })
    for (let i = 0; i < 40; i++) { runtime.observe('kernel', 'kernel', null, String(i) + '障'.repeat(2048)); runtime.observe('kernel', 'kernel', null) }
    runtime.flush()
    expect(runtime.health()).toMatchObject({ error: null, queued: 0, coverageError: null })
    expect(runtime.query((db) => db.query(operator)).total).toBe(40)
    expect(runtime.query((db) => db.readCoverage(operator))[0].gaps).toHaveLength(32)
    runtime.stop()
  })
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

describe('reviewed retention and redaction boundaries', () => {
  it('redacts opaque access-token URLs and marks context/resource truncation', () => {
    const record = event('opaque-url', { message: 'https://example.com/?access_token=opaque-value',
      context: { detail: 'x'.repeat(2000) }, resources: { detail: 'x'.repeat(2000) } })
    expect(JSON.stringify(record)).not.toContain('opaque-value'); expect(record.truncated).toBe(true)
    expect(event('malformed-source', { level: 'invalid', source: 'one' }).id).not.toBe(event('malformed-source', { level: 'invalid', source: 'two' }).id)
  })

  it('does not evict valid evidence for an already stale input', () => {
    const db = store({ retentionMs: 1000, maxEvents: 1, maxBytes: 100_000 })
    const good = event('retained-good'); db.append([good])
    db.append([{ ...event('stale-late'), ingestedAt: new Date(NOW - 2000).toISOString() }])
    expect(db.lookup(alice, good.id).status).toBe('found'); expect(db.query(alice).total).toBe(1)
  })

  it('enforces retention on idle and read-only stores without waiting for a writer', () => {
    const path = join(directory(), 'idle.db'); let now = NOW
    const policy = { retentionMs: 1000, maxEvents: 100, maxBytes: 100_000 }
    const record = event('idle'); const writer = new DiagnosticStore(path, policy, () => now)
    writer.append([record]); writer.close(); now += 2000
    const reader = new DiagnosticStore(path, policy, () => now, true); stores.push(reader)
    expect(reader.query(alice).total).toBe(0); expect(reader.lookup(alice, record.id).status).toBe('expired')
    expect(reader.bounds(alice).from).toBeNull(); expect(reader.delivery(alice).events).toHaveLength(0)
  })

  it('does not recursively enqueue rejection warnings under a tiny byte policy', () => {
    const runtime = new DiagnosticRuntime({ path: ':memory:', policy: { retentionMs: 1000, maxBytes: 1, maxEvents: 10 }, now: () => NOW, report: () => undefined })
    runtime.emit({ id: 'too-small', source: 'poise', operation: 'read', level: 'error', message: 'cause' })
    for (let i = 0; i < 10; i++) runtime.flush()
    expect(runtime.health()).toMatchObject({ queued: 0, rejected: 1 }); runtime.stop()
  })
})

describe('material cause identity', () => {
  it('separates causes after display truncation and exact stderr changes', () => {
    const prefix = 'same display '.repeat(200)
    expect(event('one-cause', { message: prefix + 'cause A' }).incidentId).not.toBe(event('other-cause', { message: prefix + 'cause B' }).incidentId)
    expect(event('cause-a', { cause: ['actual cause A'] }).incidentId).not.toBe(event('cause-b', { cause: ['actual cause B'] }).incidentId)
    expect(event('stderr-a', { stderr: 'fatal: missing ref' }).incidentId).not.toBe(event('stderr-b', { stderr: 'fatal: permission denied' }).incidentId)
    expect(event('context-a', { callId: 'attempt-1', release: 'old', context: { attempts: 1 } }).incidentId).toBe(event('context-b', { callId: 'attempt-2', release: 'new', context: { attempts: 2 } }).incidentId)
  })
})


describe('source recovery and unavailable evidence', () => {
  it('redacts configured opaque secrets at native and workspace persistence boundaries', () => {
    vi.stubEnv('POISE_TEST_TOKEN', 'opaque-configured-secret')
    try {
      const db = store()
      const native = normalize(nativeDiagnostic({ PRIORITY: 3, MESSAGE: 'opaque-configured-secret', __REALTIME_TIMESTAMP: '1792317600000000' }, 'docker', 'native-secret', null), NOW)!
      db.append([native, workspaceEnvelope({ ...event('untrusted-envelope'), message: 'opaque-configured-secret' }, 'alice', NOW, [])])
      expect(native.eventTime).toBe(new Date(NOW).toISOString())
      expect(JSON.stringify(db.query(operator))).not.toContain('opaque-configured-secret')
    } finally { vi.unstubAllEnvs() }
  })

  it('retains malformed Caller evidence even when no separate error text exists', () => {
    const input = callerDiagnostic({ id: 'f'.repeat(32), status: 'failed', diagnostic: null, evidence_unavailable: 'Stored evidence is oversized' }, 'alice')
    expect(input).toMatchObject({ source: 'collection', level: 'warning', operation: 'caller.evidence_unavailable', message: 'Stored evidence is oversized' })
  })

  it('keeps recovered historical coverage partial rather than unavailable', () => {
    const runtime = new DiagnosticRuntime({ path: ':memory:', now: () => NOW, report: () => undefined })
    runtime.observe('workspace:alice', 'poise', 'alice', 'source offline')
    runtime.partial('workspace:alice', 'poise', 'alice', 'Source is reachable; historical gap remains')
    const source = runtime.health().sources[0]
    expect(source.status).toBe('partial'); expect(source.gaps.every((gap) => gap.to !== null)).toBe(true)
    runtime.stop()
  })
})


it('redacts opaque Git configuration credentials in bare encoded and decoded evidence', () => {
  const secret = 'opaque-git-password'
  const encoded = Buffer.from('x-access-token:' + secret).toString('base64')
  vi.stubEnv('GIT_CONFIG_VALUE_0', 'Authorization: Basic ' + encoded)
  try {
    const value = event('git-config-secret', { stderr: secret + '\n' + encoded })
    expect(JSON.stringify(value)).not.toContain(secret); expect(JSON.stringify(value)).not.toContain(encoded)
  } finally { vi.unstubAllEnvs() }
})

it('keeps expiry metadata within a tiny byte budget under repeated eviction', () => {
  const db = store({ retentionMs: 30 * 86_400_000, maxBytes: 4096, maxEvents: 1_000_000 })
  for (let i = 0; i < 1000; i++) db.append([event('tiny-budget-' + i)])
  expect(db.query(alice).total).toBeGreaterThan(0)
  expect(db.lookup(alice, event('tiny-budget-0').id).status).toBe('unavailable')
  expect(db.lookup(alice, event('tiny-budget-999').id).status).toBe('found')
})
