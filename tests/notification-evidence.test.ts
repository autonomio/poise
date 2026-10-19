import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticStore } from '../gateway/src/diagnostics/store'
import { normalize } from '../gateway/src/diagnostics/contract'
import { callerDiagnostic } from '../gateway/src/diagnostics/sources'
import { joinEvidence } from '../gateway/src/diagnostics/query-evidence'
import { diagnosticEvidence, evidenceReferences } from '../gateway/src/diagnostics/evidence-contract'
import { behaviorDiagnosticGroups } from '../src/behavior-diagnostics'
import { notificationItems, NOTICE_LOOK } from '../src/notification-items'
import { NOTIFICATION_PLACEMENT } from '../src/notification-placement'
import { DIAGNOSTIC_PLACEMENT, diagnosticClassification, DIAGNOSTIC_SCOPES } from '../src/behavior-failure-cause'
import { NOTICE_KINDS, noticesFrom } from '../src/notices'
import type { BehaviorDiagnostics } from '../src/behaviors'

const access = { workspace: 'alice', operator: false }
const cause = 'error: exact preparation failure'
const correlationId = 'd'.repeat(32)
function caller(id: string, error = cause, owner = 'alice') {
  return normalize(callerDiagnostic({ id, repo: 'acme/repo', pr_id: '9', actor: 'review-bot', behavior: 'pr_review', source: 'poise:review-new-prs',
    correlation_id: correlationId, completed_at: new Date().toISOString(), error }, owner)!)!
}
const diagnostics = (): BehaviorDiagnostics => ({ status: 'ok', agentLogsError: null, datastore: { status: 'healthy', checkedAt: '', ageSeconds: 0, lastSuccessAt: null, error: null },
  identity: { status: 'valid', actor: 'review-bot', error: null }, failures: [], deadLetters: [] })
let directory = ''
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (directory) rmSync(directory, { recursive: true, force: true }) })

describe('retained exact-key association', () => {
  it('keeps repeated deliveries and distinct attempts separate without text/PR borrowing', () => {
    const db = new DiagnosticStore(':memory:')
    try {
      const first = caller('a'.repeat(32)), second = caller('b'.repeat(32))
      db.append([first, first, second, caller('c'.repeat(32), cause, 'bob')])
      const selector = { source: 'caller' as const, eventId: first.id, callId: first.callId!, correlationId, target: 'acme/repo#9', behavior: 'pr_review', cause }
      const [binding] = joinEvidence(db, access, [selector])
      expect(binding.evidence?.eventId).toBe(first.id)
      expect(db.query(access).total).toBe(2)
      for (const change of [{ eventId: 'evt_' + 'f'.repeat(16) + '_' + 'f'.repeat(64) }, { callId: second.callId! }, { correlationId: 'e'.repeat(32) },
        { behavior: 'pr_approve' }, { target: 'acme/repo#10' }, { cause: 'different material cause' }, { account: 'other' }, { repository: 'other/repo' }]) {
        expect(joinEvidence(db, access, [{ ...selector, ...change }])[0].evidence).toBeUndefined()
      }
      expect(joinEvidence(db, { workspace: 'bob', operator: false }, [selector])[0].evidence).toBeUndefined()
      expect(() => joinEvidence(db, access, [{ source: 'caller', target: 'acme/repo#9', cause }])).toThrow('exact retained identity')
      expect(db.query(access).total).toBe(2)
    } finally { db.close() }
  })
  it('bounds exact retained history and labels additional occurrences', () => {
    const db = new DiagnosticStore(':memory:')
    try {
      for (let index = 0; index < 25; index++) db.append([normalize({ id: String(index), workspace: 'alice', source: 'poise', level: 'warning', operation: 'storage.pressure',
        message: 'same condition', correlationId })!])
      const binding = joinEvidence(db, access, [{ source: 'poise', correlationId }])[0]
      expect(evidenceReferences(binding)).toHaveLength(20)
      expect(binding.evidenceMore).toBe(true)
      expect(() => joinEvidence(db, access, Array.from({ length: 21 }, () => ({ source: 'poise', correlationId })))).toThrow('twenty')
      expect(db.query(access).total).toBe(25)
    } finally { db.close() }
  })
  it('preserves exact per-attempt references before deduplicating presentation', () => {
    const db = new DiagnosticStore(':memory:')
    try {
      const events = [caller('a'.repeat(32)), caller('b'.repeat(32))]
      db.append(events)
      const state = diagnostics()
      state.deadLetters = events.map((event, index) => ({ id: String(index), behavior: 'review-new-prs', target: 'acme/repo#9', error: cause,
        createdAt: '2026-10-19T00:00:00Z', callId: event.callId, correlationId,
        ...joinEvidence(db, access, [{ source: 'caller', eventId: event.id, cause }])[0] }))
      const group = behaviorDiagnosticGroups(state)[0]
      expect(group.details).toHaveLength(1)
      expect(group.entries).toHaveLength(2)
      const item = notificationItems([], state, Date.now())[0]
      expect(evidenceReferences(item).map((ref) => ref.eventId)).toEqual(events.map((event) => event.id))
      state.deadLetters.push(state.deadLetters[0])
      expect(behaviorDiagnosticGroups(state)[0].entries).toHaveLength(2)
    } finally { db.close() }
  })
})

it('validates optional evidence without breaking old primary notice actions', () => {
  const event = caller('a'.repeat(32))
  const evidence = { eventId: event.id, incidentId: event.incidentId, from: '2026-10-19T00:00:00Z', to: '2026-10-19T01:00:00Z' }
  const primary = { id: 'notice', kind: 'behavior_held', title: 'Held', body: 'cause', since: evidence.from, due: evidence.from, silenceable: false, target: { view: 'behaviors' } }
  expect(noticesFrom({ enabled: true, notices: [{ ...primary, evidence }] })?.notices[0].evidence).toEqual(evidence)
  for (const bad of [{ ...evidence, eventId: 'https://evil.test/' }, { ...evidence, from: '2026-10-19T00:00:00' }, { ...evidence, to: '2020-01-01Z' }, { ...evidence, incidentId: 'inc_' + 'f'.repeat(16) + '_' + 'f'.repeat(64) }]) {
    expect(diagnosticEvidence(bad)).toBeNull()
    expect(noticesFrom({ enabled: true, notices: [{ ...primary, evidence: bad }] })?.notices[0]).toEqual(primary)
  }
})

it('inventories every actual server/client kind and finite diagnostic placement', async () => {
  directory = mkdtempSync(join(tmpdir(), 'poise-notification-audit-'))
  vi.stubEnv('POISE_DB', join(directory, 'cache.db'))
  vi.resetModules()
  const store = await import('../server/alerts/store')
  const database = await import('../server/db')
  try {
    expect([...store.ALERT_KINDS].sort()).toEqual([...NOTICE_KINDS].sort())
    expect(Object.keys(NOTIFICATION_PLACEMENT).sort()).toEqual([...NOTICE_KINDS, 'read_failed'].sort())
    expect(Object.keys(NOTICE_LOOK).sort()).toEqual(Object.keys(NOTIFICATION_PLACEMENT).sort())
    expect(Object.keys(DIAGNOSTIC_PLACEMENT)).toHaveLength(18)
    for (const [code, row] of Object.entries(DIAGNOSTIC_PLACEMENT)) expect(diagnosticClassification(code)).toEqual({ code, severity: row.rail })
    expect(diagnosticClassification('future-source-code')).toEqual({ code: 'future-source-code', severity: 'warning' })
    expect(DIAGNOSTIC_SCOPES).toContain('Behaviors API dynamic code')
    const quota = await import('../server/github-quota'), producer = await import('../server/alerts/producers'), notice = await import('../server/alerts/notices')
    const storage = await import('../server/temporary-storage')
    expect([quota.QUOTA_WARNING_RISK_PERCENT, quota.QUOTA_WARNING_SUSTAIN_MS, producer.DATASTORE_FAILING_ALERT_MS,
      producer.LONG_CHAT_TURN_MS, notice.EVENT_NOTICE_MS, notice.REMINDER_INTERVAL_MS, notice.READY_CHECK_INTERVAL_MS, storage.TEMPORARY_STORAGE_CHECK_MS])
      .toEqual([50, 30_000, 900_000, 120_000, 3_600_000, 900_000, 120_000, 60_000])
  } finally { database.closeDatabase() }
})

// Real producer -> independent retained store -> bounded read worker -> optional notice.
describe('read-time producer binding', () => {
  let database: typeof import('../server/db'), logging: typeof import('../server/logging'), api: typeof import('../server/logging-api')
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'poise-notice-source-'))
    vi.stubEnv('POISE_DB', join(directory, 'cache.db')); vi.stubEnv('HOME', directory); vi.stubEnv('POISE_WORKSPACE_HANDLE', 'alice')
    vi.resetModules()
    database = await import('../server/db'); logging = await import('../server/logging'); api = await import('../server/logging-api')
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    logging.startLogging()
  })
  afterEach(async () => { await api.stopLoggingApi(); await logging.stopLogging(); database.closeDatabase() })
  it('retains exact storage crossings across dismissal and recovery without read-created occurrences', async () => {
    const storage = await import('../server/temporary-storage'), notices = await import('../server/alerts/notices'), bindings = await import('../server/notification-evidence')
    storage.temporaryStorageMeasured(4.9 * storage.TEMPORARY_STORAGE_GB)
    logging.loggingRuntime()!.flush()
    const first = await bindings.noticeEvidence(notices.noticesState())
    const evidence = first.notices[0].evidence!
    expect(evidence?.eventId).toMatch(/^evt_/)
    const total = logging.loggingRuntime()!.query((db) => db.query(access)).total
    expect((await bindings.noticeEvidence(notices.noticesState())).notices[0].evidence).toEqual(evidence)
    expect(logging.loggingRuntime()!.query((db) => db.query(access)).total).toBe(total)
    notices.dismissNotice(first.notices[0].id)
    expect(notices.noticesState().notices).toEqual([])
    storage.temporaryStorageMeasured(6 * storage.TEMPORARY_STORAGE_GB)
    await new Promise((resolve) => setTimeout(resolve, 5))
    storage.temporaryStorageMeasured(4.9 * storage.TEMPORARY_STORAGE_GB)
    logging.loggingRuntime()!.flush()
    expect((await bindings.noticeEvidence(notices.noticesState())).notices[0].evidence?.eventId).not.toBe(evidence.eventId)
    expect(logging.loggingRuntime()!.query((db) => db.lookup(access, evidence.eventId)).status).toBe('found')
  })
  it('joins a pre-launch exception by its exact context; later failures cannot borrow its record', async () => {
    const context = await import('../server/logging-context'), bindings = await import('../server/notification-evidence')
    const identity = { correlationId, behavior: 'review-new-prs', target: 'acme/repo#9', repository: 'acme/repo', account: 'review-bot' }
    const error = new Error(cause)
    await expect(context.withNoticeDiagnosticIdentity(identity, async () => { throw error })).rejects.toThrow(cause)
    // The existing console exception capture receives the original error outside the async context.
    logging.diagnosticFailure('application.exception', error)
    logging.loggingRuntime()!.flush()
    const state = diagnostics()
    state.failures = [{ behavior: 'review-new-prs', target: 'acme/repo#9:check', kind: 'operation', consecutiveFailures: 1, lastFailureAt: new Date().toISOString(), nextRetryAt: '', error: cause, correlationId }]
    const first = await bindings.behaviorEvidence(state)
    expect(first.failures[0].evidence?.eventId).toMatch(/^evt_/)
    state.failures[0].correlationId = 'f'.repeat(32)
    expect((await bindings.behaviorEvidence(state)).failures[0].evidence).toBeUndefined()
    state.failures = []
    expect((await bindings.behaviorEvidence(state)).failures).toEqual([])
  })
})
