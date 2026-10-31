// Caller pytest supplies actual --logs bytes. This isolated contract harness
// creates no GitHub artifact, provider process or live workflow evidence.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { parseAgentLogStdout } from '../../server/agent-log-parse'
import { BehaviorChainJournal, chainIdentity, type ChainBehavior } from '../../server/behavior-chain-store'
import { BehaviorChainRuntime, type ChainRuntimeOperations } from '../../server/behavior-chain-runtime'

const wire = readFileSync(process.argv[2], 'utf8')
const snapshot = parseAgentLogStdout(wire, 'actual native correlation-fence output')
assert.equal(snapshot.quarantined.length, 0, JSON.stringify(snapshot.quarantined))
assert.equal(snapshot.entries.length, 1)
const call = snapshot.entries[0]
assert.ok(call.repo && call.actor && call.correlation_id && call.completed_at)
const behavior = ({ issue_review: 'review-issue', implement_issue: 'implement-issue', repair_pr: 'repair-pr',
  pr_review: 'review-pr', pr_approve: 'approve-pr' } as Record<string, ChainBehavior>)[call.behavior!]
assert.ok(behavior)
const db = new Database(':memory:')
try {
  const journal = new BehaviorChainJournal(db)
  const id = chainIdentity(call.repo, 7)
  let chain = journal.append(id, 'seed', 0, { type: 'chain.admitted', repository: call.repo, issue: 7,
    branch: 'poise/issue-7', author: 'author', reviewer: 'reviewer' })
  chain = journal.append(id, 'admit', chain.sequence, { type: 'invocation.admitted', invocation: { id: call.correlation_id,
    behavior, actor: call.actor, model: call.model, slot: 'primary', basis: 'original-contract-admission',
    reservation: { memoryBytes: 8, diskBytes: 16 }, admittedAt: Date.parse(call.started_at_precise ?? call.started_at) - 1000,
    request: { command: 'agent-interface', cwd: '/isolated-contract', argv: [] } } })
  journal.append(id, 'start', chain.sequence, { type: 'invocation.started', invocationId: call.correlation_id })
  assert.equal(journal.liveModelInvocationCount(), 1)
  const forbidden = async () => { throw new Error('receipt reconciliation must not execute work') }
  const reviewer = { slot: 'primary', model: call.model, recovery: call.model }
  const operations: ChainRuntimeOperations = { enabled: () => false, accounts: () => ({ author: 'author', reviewer: 'reviewer' }),
    discover: async () => [], ownsRepository: () => true, readInvocations: async () => parseAgentLogStdout(wire, 'actual native receipt'),
    observe: async () => ({ checkedAt: Date.now(), existingPulls: [], issue: { open: false, eligible: false, revision: 'closed', commentIds: [] },
      issueReviewers: [reviewer], prReviewers: [reviewer], implementer: reviewer, repairer: reviewer, approver: reviewer,
      publication: { pull_number: null, head_sha: null, head_invocation: null, state: null, merged: false, merge_sha: null }, pull: null }),
    available: () => false, capacity: () => 1, permitted: () => false, received: () => {}, request: forbidden, launch: forbidden,
    perform: forbidden, resumePublication: forbidden, fenceClosedTarget: forbidden, wake: () => {} }
  await new BehaviorChainRuntime(journal, operations).run()
  const current = journal.read(id)!
  assert.equal(current.invocations[0].state, 'settled')
  assert.equal(current.invocations[0].outcome, 'target_closed')
  assert.equal(journal.liveModelInvocationCount(), 0)
  assert.deepEqual(journal.reservedResources(), { memoryBytes: 0, diskBytes: 0, unaccounted: 0 })
  const events = journal.history(id)
  journal.rebuild()
  assert.deepEqual(journal.history(id), events)
  assert.deepEqual(journal.read(id), current)
  for (const change of [{ artifact: null }, { source: 'poise:review-new-prs' }, { resources_settled_at: null },
    { head_sha: 'a'.repeat(40) }, { review_id: 91 }, { artifact: { phase: 'admission_fenced', publication: {} } }]) {
    const rejected = parseAgentLogStdout(JSON.stringify([{ ...call, ...change }]), 'invalid native fence proof')
    assert.equal(rejected.entries.length, 0, JSON.stringify(change))
    assert.equal(rejected.quarantined.length, 1)
  }
  process.stdout.write(JSON.stringify({ accepted: 1, settled: 1, reservations: 0 }))
} finally { db.close() }
