import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { BehaviorChainJournal, type BehaviorChain, type ChainEvent } from '../server/behavior-chain-store'
import type { ChainObservation } from '../server/behavior-chain-decision'
import { BehaviorChainRuntime, type ChainRuntimeOperations } from '../server/behavior-chain-runtime'

const NOW = 1_800_000_000_000
const MERGE = 'c'.repeat(40)
const reviewer = { slot: 'primary', model: 'fixture', recovery: 'fixture' }
const databases: Database.Database[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers() })

function setup() {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  const db = new Database(':memory:'); databases.push(db)
  return { db, journal: new BehaviorChainJournal(db) }
}
function record(journal: BehaviorChainJournal, chain: BehaviorChain, event: ChainEvent) {
  return journal.append(chain.id, `${chain.id}:${chain.sequence}`, chain.sequence, event)
}
function seed(journal: BehaviorChainJournal, repository = 'acme/repo', issue = 7) {
  const id = `${repository}#${issue}`
  return journal.append(id, `seed:${id}`, 0, { type: 'chain.admitted', repository, issue,
    branch: `poise/issue-${issue}`, author: 'author', reviewer: 'reviewer' })
}
function observation(merged = true): ChainObservation {
  return { checkedAt: Date.now(), existingPulls: [], issue: { open: true, eligible: true, revision: 'seed', commentIds: [] },
    issueReviewers: [], prReviewers: [reviewer], implementer: reviewer, repairer: reviewer, approver: reviewer,
    publication: { pull_number: merged ? 17 : null, head_sha: merged ? 'a'.repeat(40) : null,
      head_invocation: null, state: merged ? 'closed' : null, merged, merge_sha: merged ? MERGE : null },
    pull: merged ? { number: 17, head: 'a'.repeat(40), headSince: NOW - 1000, state: 'closed', draft: false, merged: true,
      mergeSha: MERGE, mergedAt: NOW - 1000, queueEntry: null, queueRemoval: null, changesRequested: false,
      unresolved: 0, approved: false, ready: false, reviewIds: [], reviewRevision: 'missing', reviewContext: 'b'.repeat(64),
      reviewReceipts: [], greyRuns: [], pending: false, failing: [], conflict: false, behind: false } : null }
}
function operations(overrides: Partial<ChainRuntimeOperations> = {}): ChainRuntimeOperations {
  const forbidden = async () => { throw new Error('reconciliation fixture must not start work') }
  return { enabled: () => false, accounts: () => ({ author: 'author', reviewer: 'reviewer' }), discover: async () => [],
    ownsRepository: () => true, observe: async () => observation(), readInvocations: async () => ({ entries: [], quarantined: [] }),
    received: () => {}, available: () => false, capacity: () => 3, permitted: () => false, request: forbidden,
    launch: forbidden, perform: forbidden, resumePublication: forbidden, wake: () => {}, ...overrides }
}

it('deduplicates merged holds and bounds repeated observation from durable state across runtime replacement', async () => {
  const { journal } = setup()
  const chain = seed(journal)
  const observe = vi.fn(async () => observation())
  const runtime = new BehaviorChainRuntime(journal, operations({ observe }))
  await runtime.run()
  const original = journal.history(chain.id)
  for (let pass = 0; pass < 5; pass++) await runtime.run()
  expect(journal.history(chain.id)).toEqual(original)
  expect(observe).toHaveBeenCalledTimes(1)
  journal.rebuild()
  await new BehaviorChainRuntime(journal, operations({ observe })).run()
  expect(observe).toHaveBeenCalledTimes(1)
  vi.setSystemTime(NOW + 120_000)
  await runtime.run()
  expect(observe).toHaveBeenCalledTimes(2)
  expect(journal.history(chain.id).filter((row) => JSON.parse(row.payload).type === 'chain.held')).toHaveLength(1)
  vi.setSystemTime(NOW + 240_000)
  await runtime.run()
  expect(observe).toHaveBeenCalledTimes(2)
  expect(journal.active().map((row) => row.id)).toContain(chain.id)
})

it('preserves the person hold rather than replacing it with a merge-verification hold', async () => {
  const { journal } = setup()
  let chain = seed(journal)
  chain = record(journal, chain, { type: 'chain.held', reason: 'New invocations held by the person' })
  await new BehaviorChainRuntime(journal, operations()).run()
  expect(journal.read(chain.id)?.held).toBe('New invocations held by the person')
})

it('reconciles live work on every pass despite 250 quiescent merged chains and one failing observation', async () => {
  const { db, journal } = setup()
  db.transaction(() => {
    for (let issue = 1; issue <= 250; issue++) {
      let chain = seed(journal, 'aaa/repo', issue)
      chain = record(journal, chain, { type: 'chain.observed', observation: observation() })
      chain = record(journal, chain, { type: 'chain.merged', mergeSha: MERGE, evidence: { repository: chain.repository,
        pull_number: 17, merged: true, merge_sha: MERGE, review_complete: false } })
      record(journal, chain, { type: 'chain.held', reason: 'qualifying original review response missing' })
    }
  })()
  const live = seed(journal, 'zzz/repo', 1)
  const observed: string[] = []
  const runtime = new BehaviorChainRuntime(journal, operations({ observe: async (chain) => {
    observed.push(chain.id)
    if (chain.id === 'aaa/repo#1') throw new Error('retained source failure')
    return observation(chain.id !== live.id)
  } }))
  for (let pass = 0; pass < 3; pass++) {
    observed.length = 0
    await runtime.run()
    expect(observed).toEqual([live.id])
  }
  vi.setSystemTime(NOW + 120_000)
  await expect(runtime.run()).rejects.toThrow('retained source failure')
  expect(observed).toContain(live.id)
})

it('keeps merged journal-only uncertainty without repeatedly reading GitHub or sending another action', async () => {
  const { journal } = setup()
  let chain = seed(journal)
  chain = record(journal, chain, { type: 'invocation.admitted', invocation: { id: 'original-action', behavior: 'merge-pr',
    actor: 'reviewer', model: null, slot: null, basis: 'merge', admittedAt: NOW - 5000,
    request: { command: 'github-interface', cwd: '/fixture', argv: ['--merge-if-ready', '17', '--expected-head', 'a'.repeat(40), '--token-user', 'reviewer'] } } })
  chain = record(journal, chain, { type: 'invocation.uncertain', invocationId: 'original-action', reason: 'original response absent' })
  chain = record(journal, chain, { type: 'chain.observed', observation: observation() })
  chain = record(journal, chain, { type: 'chain.merged', mergeSha: MERGE, evidence: { repository: chain.repository,
    pull_number: 17, merged: true, merge_sha: MERGE, review_complete: false } })
  const before = journal.history(chain.id)
  const observe = vi.fn(async () => observation())
  for (let pass = 0; pass < 5; pass++) await new BehaviorChainRuntime(journal, operations({ observe })).run()
  expect(observe).not.toHaveBeenCalled()
  expect(journal.history(chain.id)).toEqual(before)
  expect(journal.read(chain.id)?.invocations[0].state).toBe('uncertain')
})
