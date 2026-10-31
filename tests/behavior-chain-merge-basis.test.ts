import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { BehaviorChainJournal, chainBasis, type ChainEvent } from '../server/behavior-chain-store'
import { decideBehaviorChain, type ChainObservation } from '../server/behavior-chain-decision'
import { BehaviorChainRuntime, type ChainRuntimeOperations } from '../server/behavior-chain-runtime'
import { completedReviewCall } from './review-response-fixture'

const databases: Database.Database[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers() })
const HEAD = 'a'.repeat(40)
const MERGE = 'c'.repeat(40)
const reviewer = { slot: 'primary', model: 'fixture', recovery: 'fixture' }

function setup(path = ':memory:') {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000)
  const db = new Database(path); databases.push(db)
  const journal = new BehaviorChainJournal(db)
  let chain = journal.append('acme/repo#7', 'seed', 0, { type: 'chain.admitted', repository: 'acme/repo', issue: 7,
    branch: 'poise/issue-7', author: 'author', reviewer: 'reviewer' })
  const call = completedReviewCall(chain.repository, 17, HEAD, chain.reviewer)
  const observation: ChainObservation = { checkedAt: Date.now(), existingPulls: [], issue: { open: true, eligible: true, revision: 'issue', commentIds: [] },
    issueReviewers: [], prReviewers: [reviewer], implementer: reviewer, repairer: reviewer, approver: reviewer,
    publication: { pull_number: 17, head_sha: HEAD, head_invocation: 'implementation', state: 'open', merged: false, merge_sha: null },
    pull: { number: 17, head: HEAD, headSince: Date.now(), state: 'open', draft: false, merged: false, mergeSha: null,
      queueEntry: null, queueRemoval: null, changesRequested: false, unresolved: 0, approved: true, ready: true,
      reviewIds: [call.review_id!], reviewRevision: 'review', reviewContext: 'b'.repeat(64), reviewReceipts: [{ id: call.review_id!,
        head: HEAD, state: 'COMMENTED', invocation: call.id, response: call.artifact!.review_response, submittedAt: Date.now() }],
      greyRuns: [], pending: false, failing: [], conflict: false, behind: false } }
  const record = (event: ChainEvent) => { chain = journal.append(chain.id, `event-${chain.sequence}`, chain.sequence, event); return chain }
  record({ type: 'invocation.admitted', invocation: { id: 'original-review', behavior: 'review-pr',
    actor: chain.reviewer, model: call.model, slot: 'primary', basis: chainBasis(['pr', HEAD, observation.pull!.reviewContext]),
    admittedAt: Date.parse(call.started_at), request: { command: 'agent-interface', cwd: '/fixture', argv: [] } } })
  record({ type: 'invocation.settled', invocationId: 'original-review', callId: call.id, outcome: 'clean',
    evidence: { status: 'completed', action: 'reviewed_clean', outcome: 'clean', review_id: call.review_id,
      head_sha: HEAD, completedAt: Date.parse(call.completed_at!), artifact: call.artifact } })
  function merge(live: ChainObservation) {
    vi.setSystemTime(Date.now() + 1000)
    return { ...structuredClone(live), checkedAt: Date.now(), pull: { ...live.pull!, merged: true, state: 'closed', mergeSha: MERGE,
      mergedAt: Date.now() - 500 } }
  }
  return { db, journal, record, observation, merge, current: () => chain }
}

it('does not discharge an old obligation when the PR context is restored after merge', () => {
  const { record, observation, merge, current } = setup()
  const before = structuredClone(observation)
  before.pull!.reviewContext = 'd'.repeat(64)
  record({ type: 'chain.observed', observation: before })
  expect(decideBehaviorChain(current(), merge(observation), Date.now())).toMatchObject({ kind: 'hold' })
})

it('does not discharge the original two-slot panel when current settings require one', () => {
  const { record, observation, merge, current } = setup()
  const before = structuredClone(observation)
  before.prReviewers.push({ ...reviewer, slot: 'secondary' })
  record({ type: 'chain.observed', observation: before })
  expect(decideBehaviorChain(current(), merge(observation), Date.now())).toMatchObject({ kind: 'hold' })
})

it('does not substitute the last open context for a changed merged context', () => {
  const { record, observation, merge, current } = setup()
  record({ type: 'chain.observed', observation: structuredClone(observation) })
  const live = merge(observation)
  live.pull.reviewContext = 'd'.repeat(64)
  expect(decideBehaviorChain(current(), live, Date.now())).toMatchObject({ kind: 'hold' })
})

it('retains a mismatch seen at the first merge after the live context is restored', async () => {
  const { journal, record, observation, merge, current } = setup()
  record({ type: 'chain.observed', observation: structuredClone(observation) })
  const live = merge(observation)
  live.pull.reviewContext = 'd'.repeat(64)
  const forbidden = async () => { throw new Error('merged evidence reconciliation cannot start work') }
  const operations: ChainRuntimeOperations = { enabled: () => false, accounts: () => ({ author: 'author', reviewer: 'reviewer' }),
    discover: async () => [], ownsRepository: () => true, observe: async () => structuredClone(live),
    readInvocations: async () => ({ entries: [], quarantined: [] }), received: () => {}, available: () => false, capacity: () => 3,
    permitted: () => false, request: forbidden, launch: forbidden, perform: forbidden, resumePublication: forbidden, fenceClosedTarget: forbidden, wake: () => {} }
  const runtime = new BehaviorChainRuntime(journal, operations)
  await runtime.run()
  expect(journal.read(current().id)).toMatchObject({ mergeSha: MERGE, reviewPending: true })
  live.pull.reviewContext = observation.pull!.reviewContext
  await runtime.run()
  journal.rebuild()
  expect(journal.read(current().id)).toMatchObject({ mergeSha: MERGE, reviewPending: true })
})

it('allows newly visible original pre-merge evidence against the original panel despite a later settings increase', () => {
  const { record, observation, merge, current } = setup()
  const before = structuredClone(observation)
  before.pull!.reviewReceipts = []; before.pull!.reviewIds = []
  record({ type: 'chain.observed', observation: before })
  const live = merge(observation)
  live.prReviewers.push({ ...reviewer, slot: 'secondary' })
  expect(decideBehaviorChain(current(), live, Date.now())).toEqual({ kind: 'complete', mergeSha: MERGE })
})

it('keeps missing historical basis and an empty recorded panel unproven', () => {
  const { record, observation, merge, current } = setup()
  const live = merge(observation)
  expect(decideBehaviorChain(current(), live, Date.now())).toMatchObject({ kind: 'hold' })
  const before = structuredClone(observation)
  before.prReviewers = []
  record({ type: 'chain.observed', observation: before })
  expect(decideBehaviorChain(current(), live, Date.now())).toMatchObject({ kind: 'hold' })
})

it('does not accept a later submission or a different merged head as original review proof', () => {
  const { record, observation, merge, current } = setup()
  record({ type: 'chain.observed', observation: structuredClone(observation) })
  const live = merge(observation)
  live.pull.reviewReceipts[0].submittedAt = live.pull.mergedAt! + 1
  expect(decideBehaviorChain(current(), live, Date.now())).toMatchObject({ kind: 'hold' })
  live.pull.reviewReceipts[0].submittedAt = live.pull.mergedAt! - 1
  live.pull.head = 'e'.repeat(40)
  expect(decideBehaviorChain(current(), live, Date.now())).toMatchObject({ kind: 'hold' })
})

it('recovers late original visibility through the runtime without a replacement worker or current-roster authority', async () => {
  const { journal, record, observation, merge, current } = setup()
  const before = structuredClone(observation)
  before.pull!.reviewReceipts = []; before.pull!.reviewIds = []
  record({ type: 'chain.observed', observation: before })
  const live = merge(observation)
  live.prReviewers.push({ ...reviewer, slot: 'secondary' })
  const launch = vi.fn(async () => { throw new Error('a merged chain cannot launch a worker') })
  const operations: ChainRuntimeOperations = { enabled: () => false, accounts: () => ({ author: 'author', reviewer: 'reviewer' }),
    discover: async () => [], ownsRepository: () => true, observe: async () => live,
    readInvocations: async () => ({ entries: [], quarantined: [] }), received: () => {}, available: () => false, capacity: () => 3,
    permitted: () => false, request: launch, launch, perform: launch, resumePublication: launch, fenceClosedTarget: launch, wake: () => {} }
  await new BehaviorChainRuntime(journal, operations).run()
  expect(journal.read(current().id)).toMatchObject({ mergeSha: MERGE, reviewPending: false })
  expect(launch).not.toHaveBeenCalled()
})

it('retains the original basis across later observations, projection rebuild and reopening the database', () => {
  const root = mkdtempSync(join(tmpdir(), 'poise-merge-basis-'))
  const path = join(root, 'journal.db')
  try {
    const { db, journal, record, observation, merge, current } = setup(path)
    const before = structuredClone(observation)
    before.prReviewers.push({ ...reviewer, slot: 'secondary' })
    record({ type: 'chain.observed', observation: before })
    const live = merge(observation)
    record({ type: 'chain.observed', observation: live })
    record({ type: 'chain.merged', mergeSha: MERGE, evidence: { repository: 'acme/repo', pull_number: 17,
      merged: true, merge_sha: MERGE, review_complete: false } })
    for (let repeat = 0; repeat < 10; repeat++) record({ type: 'chain.observed', observation: live })
    const authority = db.prepare('SELECT sequence, payload, state_hash FROM behavior_chain_events ORDER BY sequence').all()
    expect(journal.preMergeObservation(current().id, live.pull.mergedAt!)).toEqual(before)
    journal.rebuild()
    expect(db.prepare('SELECT sequence, payload, state_hash FROM behavior_chain_events ORDER BY sequence').all()).toEqual(authority)
    const id = current().id
    db.close(); databases.splice(databases.indexOf(db), 1)
    const reopened = new Database(path); databases.push(reopened)
    const retained = new BehaviorChainJournal(reopened)
    const basis = retained.preMergeObservation(id, live.pull.mergedAt!) as ChainObservation | null
    expect(basis).toEqual(before)
    expect(decideBehaviorChain(retained.read(id)!, live, Date.now(), {
      before: basis, firstMerged: retained.firstMergedObservation(id) as ChainObservation | null,
    })).toMatchObject({ kind: 'hold' })
    expect(retained.read(id)).toMatchObject({ mergeSha: MERGE, reviewPending: true })
    reopened.close(); databases.splice(databases.indexOf(reopened), 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('does not turn a later observation with a backdated clock into missing pre-merge authority', () => {
  const { journal, record, observation, merge, current } = setup()
  const live = merge(observation)
  record({ type: 'chain.merged', mergeSha: MERGE, evidence: { repository: 'acme/repo', pull_number: 17,
    merged: true, merge_sha: MERGE, review_complete: false } })
  vi.setSystemTime(live.pull.mergedAt! - 10)
  record({ type: 'chain.observed', observation })
  expect(journal.preMergeObservation(current().id, live.pull.mergedAt!)).toBeNull()
})
