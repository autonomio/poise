import { expect, it, vi } from 'vitest'
import { BehaviorChainJournal, chainBasis, chainIdentity, type BehaviorChain, type ChainEvent } from '../server/behavior-chain-store'
import type { ChainObservation } from '../server/behavior-chain-decision'
import { CheckSemaphore } from '../server/check-semaphore'
import { arrangeCli, fixture, loadModules, mocks, pr } from './behaviors-runtime-fixture'
import { completedReviewCall } from './review-response-fixture'

const HEAD = 'a'.repeat(40)
const MERGE = 'b'.repeat(40)
const reviewer = { slot: 'primary', model: 'fixture', recovery: 'fixture' }

function observation(now: number): ChainObservation {
  return { checkedAt: now, issue: { open: true, revision: 'body', eligible: true, commentIds: [] },
    issueReviewers: [], prReviewers: [reviewer], implementer: reviewer, repairer: reviewer, approver: reviewer, existingPulls: [],
    publication: { pull_number: pr.number, head_sha: HEAD, head_invocation: 'native-implementation', state: 'open', merged: false, merge_sha: null },
    pull: { number: pr.number, head: HEAD, headSince: now, state: 'open', draft: false, merged: false, mergeSha: null,
      queueEntry: null, queueRemoval: null, changesRequested: false, unresolved: 0, approved: false, ready: false,
      reviewIds: [], reviewReceipts: [], reviewContext: 'c'.repeat(64), reviewRevision: 'reviews', greyRuns: [],
      checksState: 'PENDING', readinessBlockers: ['reviewer_not_approved_current_head'],
      pending: true, failing: [], conflict: false, behind: false } }
}

function record(journal: BehaviorChainJournal, chain: BehaviorChain, event: ChainEvent): BehaviorChain {
  return journal.append(chain.id, `${chain.id}:${chain.sequence}`, chain.sequence, event)
}

async function setup() {
  const { database: db, behaviors: runtime } = await loadModules()
  db.setMeta('me', 'poise-user')
  db.setMeta('behavior_chain_settings', JSON.stringify({ enabled: true, seedMode: 'label', label: 'work-ready' }))
  arrangeCli()
  const journal = new BehaviorChainJournal(db.db)
  const draining = journal.changeAdmission(0, 'draining')
  journal.changeAdmission(draining.sequence, 'v2')
  let chain = journal.append(chainIdentity(pr.repo, 7), 'seed', 0, { type: 'chain.admitted', repository: pr.repo, issue: 7,
    branch: 'poise/issue-7', author: 'poise-user', reviewer: 'review-bot' })
  const obs = observation(Date.now())
  chain = record(journal, chain, { type: 'chain.observed', observation: obs })
  const status = await import('../server/behavior-pr-status')
  status.resetPrStatusCaches()
  return { db, runtime, journal, chain, obs, status }
}

it('projects the canonical chain without legacy review-cap escape or missing merge-cache guesses', async () => {
  const { runtime, journal, chain, status } = await setup()
  runtime.setReviewCap(1)
  const before = journal.history(chain.id)
  const reply = await status.readPrStatus(50)
  expect(reply.rows[0]).toMatchObject({ ownership: { engine: 'v2', chainId: chain.id, reviews: { completed: 0, required: 1 } },
    rounds: { completed: null, cap: null }, ci: { state: 'PENDING', head: HEAD },
    blocker: { id: 'ci_pending', line: 'v2 exact-head CI is running' } })
  expect(journal.history(chain.id)).toEqual(before)
  expect(mocks.spawnDetached).not.toHaveBeenCalled()
  expect(mocks.runFile.mock.calls.every(([command]) => command === 'github-datastore')).toBe(true)
})

it('keeps an original uncertain action distinct from the actual merge and open review obligation', async () => {
  const { journal, chain, obs, status } = await setup()
  let current = record(journal, chain, { type: 'invocation.admitted', invocation: { id: 'original-merge', behavior: 'merge-pr',
    actor: chain.reviewer, model: null, slot: null, basis: 'merge', admittedAt: Date.now(),
    request: { command: 'github-interface', cwd: '/fixture', argv: ['--merge-if-ready', String(pr.number)] } } })
  current = record(journal, current, { type: 'invocation.uncertain', invocationId: 'original-merge', reason: 'original response missing' })
  Object.assign(obs.pull!, { merged: true, state: 'closed', mergeSha: MERGE, checksState: null, pending: false })
  current = record(journal, current, { type: 'chain.observed', observation: obs })
  record(journal, current, { type: 'chain.merged', mergeSha: MERGE, evidence: { repository: chain.repository,
    pull_number: pr.number, merged: true, merge_sha: MERGE, review_complete: false } })
  const reply = await status.readPrStatus(50)
  expect(reply.rows[0]).toMatchObject({ ownership: { engine: 'v2', mergeSha: MERGE, reviewPending: true },
    blocker: { id: 'held' }, ci: { state: 'unknown' } })
  expect(reply.rows[0].blocker.line).toContain('review evidence pending')
  expect(reply.rows[0].blocker.details).toContain('original response missing')
  expect(journal.read(chain.id)!.invocations[0].state).toBe('uncertain')
})

it.each([true, false])('counts only verified current-context review slots, with current context matching: %s', async (matching) => {
  const { journal, chain, obs, status } = await setup()
  const call = completedReviewCall(pr.repo, pr.number, HEAD, chain.reviewer)
  const response = call.artifact!.review_response as { context_sha: string }
  Object.assign(obs.pull!, { reviewContext: matching ? response.context_sha : 'd'.repeat(64),
    approved: true, ready: true, checksState: 'SUCCESS', pending: false, reviewIds: [call.review_id!],
    reviewReceipts: [{ id: call.review_id!, head: HEAD, state: 'COMMENTED', invocation: call.id,
      response, submittedAt: Date.parse(call.completed_at!) }] })
  let current = record(journal, chain, { type: 'invocation.admitted', invocation: { id: 'review', behavior: 'review-pr',
    actor: chain.reviewer, model: call.model, slot: reviewer.slot, basis: chainBasis(['pr', HEAD, response.context_sha]),
    admittedAt: Date.parse(call.started_at), request: { command: 'agent-interface', cwd: '/fixture', argv: [] } } })
  current = record(journal, current, { type: 'invocation.settled', invocationId: 'review', callId: call.id, outcome: 'clean',
    evidence: { status: 'completed', action: 'reviewed_clean', review_id: call.review_id, head_sha: HEAD,
      completedAt: Date.parse(call.completed_at!), artifact: call.artifact } })
  obs.checkedAt = Date.now()
  record(journal, current, { type: 'chain.observed', observation: obs })
  const reply = await status.readPrStatus(50)
  expect(reply.rows[0].ownership?.reviews).toEqual({ completed: matching ? 1 : 0, required: 1 })
  expect(reply.rows[0].ci).toMatchObject({ state: 'SUCCESS' })
  expect(reply.rows[0].blocker.id).toBe(matching ? 'approved_not_enqueued' : 'awaiting_review')
  expect(reply.rows[0].verdict?.onCurrentHead ?? null).toBe(matching ? true : null)
})

it('does not let an earlier successful rollup hide a later same-head failing check', async () => {
  const { journal, chain, obs, status } = await setup()
  Object.assign(obs.pull!, { checksState: 'SUCCESS', pending: false, failing: ['native-check:failure'] })
  record(journal, chain, { type: 'chain.observed', observation: obs })
  const reply = await status.readPrStatus(50)
  expect(reply.rows[0]).toMatchObject({ ci: { state: 'FAILURE' }, blocker: { id: 'ci_failing' } })
})

it.each(['stale', 'future'])('keeps %s observations unknown instead of reporting zero completed reviews or green CI', async (kind) => {
  const { status, obs } = await setup()
  const now = kind === 'stale' ? obs.checkedAt + 121_000 : obs.checkedAt - 1
  const reply = await status.readPrStatus(50, now)
  expect(reply.health.status).toBe('stale')
  expect(reply.rows[0]).toMatchObject({ ownership: { engine: 'v2', reviews: { completed: null, required: null } },
    rounds: { completed: null, next: null }, ci: { state: 'unknown' }, queue: { state: 'unknown' }, blocker: { id: 'unknown' } })
})

it('reports the actual queue rejection and retains blocker age across repeated observations', async () => {
  const { journal, chain, obs, status } = await setup()
  obs.pull!.queueRemoval = { id: 'rejected-entry', reason: 'failed_checks', at: obs.checkedAt, actor: null }
  const current = record(journal, chain, { type: 'chain.observed', observation: obs })
  const first = await status.readPrStatus(50, obs.checkedAt)
  expect(first.rows[0]).toMatchObject({ queue: { state: 'ejected' }, blocker: { id: 'awaiting_author' } })
  expect(first.rows[0].blocker.line).toContain('failed_checks')
  obs.checkedAt += 60_000
  record(journal, current, { type: 'chain.observed', observation: obs })
  const repeated = await status.readPrStatus(50, obs.checkedAt)
  expect(repeated.rows[0].blocker.since).toBe(first.rows[0].blocker.since)
})

it('keeps a paused chain and a legacy PR under their respective status rules', async () => {
  const { db, runtime, chain, status } = await setup()
  db.setMeta('behavior_chain_settings', JSON.stringify({ enabled: false, seedMode: 'all', label: 'work-ready' }))
  runtime.setReviewCap(3)
  fixture.listedPrs = [pr, { ...pr, number: 18, url: `${pr.url.slice(0, -2)}18`, head_ref: 'personal-work', head_repo: pr.repo }]
  const reply = await status.readPrStatus(50)
  expect(reply.rows.find((row) => row.number === pr.number)).toMatchObject({ ownership: { engine: 'v2', chainId: chain.id },
    rounds: { cap: null }, blocker: { id: 'blocked', line: 'v2 admissions paused; existing ownership is retained' } })
  expect(reply.rows.find((row) => row.number === 18)).toMatchObject({ ownership: { engine: 'v1' }, rounds: { cap: 3 } })
})

it('does not list a confirmed completed chain as an open PR while the datastore catches up', async () => {
  const { journal, chain, status } = await setup()
  record(journal, chain, { type: 'chain.merged', mergeSha: MERGE, evidence: { repository: chain.repository,
    pull_number: pr.number, merged: true, merge_sha: MERGE, review_complete: true } })
  expect((await status.readPrStatus(50)).totalOpen).toBe(0)
})

it('does not fall back to legacy status when the journal projection is contradictory', async () => {
  const { db, chain, status } = await setup()
  db.db.prepare("UPDATE behavior_chain_current SET state = json_set(state, '$.held', 'unrecorded change') WHERE chain_id = ?").run(chain.id)
  await expect(status.readPrStatus(50)).rejects.toThrow('authoritative event journal')
})

it('refuses unprovable legacy ownership while an active native branch may own the PR', async () => {
  const { status } = await setup()
  fixture.listedPrs = [{ ...pr, number: 18, url: `${pr.url.slice(0, -2)}18` }]
  await expect(status.readPrStatus(50)).rejects.toThrow('branch evidence needed')
})

it('bounds status previews and pagination without truncating authoritative hold evidence', async () => {
  const { journal, chain, status } = await setup()
  const reason = 'retained failure evidence '.repeat(2000)
  const listed = []
  for (let offset = 0; offset < 101; offset++) {
    const number = offset + 1000
    listed.push({ ...pr, number, url: `https://github.com/${pr.repo}/pull/${number}` })
    let target = journal.append(chainIdentity(pr.repo, number), `large-seed-${number}`, 0, { type: 'chain.admitted',
      repository: pr.repo, issue: number, branch: `poise/issue-${number}`, author: chain.author, reviewer: chain.reviewer })
    const obs = observation(Date.now())
    obs.publication.pull_number = number
    obs.pull!.number = number
    target = record(journal, target, { type: 'chain.observed', observation: obs })
    record(journal, target, { type: 'chain.held', reason })
  }
  fixture.listedPrs = listed
  const reply = await status.readPrStatus(100)
  expect(reply).toMatchObject({ totalOpen: 101, truncated: true })
  expect(reply.rows).toHaveLength(100)
  expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(512 * 1024)
  expect(reply.rows[0].blocker.details[0]).toHaveLength(1024)
  expect(journal.read(chainIdentity(pr.repo, 1000))!.held).toBe(reason)
})

it('keeps durable model reservations visible after replacing the process-local semaphore', async () => {
  const { runtime, journal, chain } = await setup()
  let current = record(journal, chain, { type: 'invocation.admitted', invocation: { id: 'surviving-model', behavior: 'review-pr',
    actor: chain.reviewer, model: 'fixture', slot: 'primary', basis: 'review', admittedAt: Date.now(),
    request: { command: 'agent-interface', cwd: '/fixture', argv: [] } } })
  current = record(journal, current, { type: 'invocation.uncertain', invocationId: 'surviving-model', reason: 'native process ownership unresolved' })
  runtime.setBehaviorCheckSlots(new CheckSemaphore(() => 4))
  expect(runtime.getBehaviorCheckSlots().stats().running).toBe(0)
  expect(runtime.getBehaviorChainCapacity()).toMatchObject({ status: 'available', reservedModelInvocations: 1,
    modelInvocationLimit: 3, enabled: true, intake: { seedMode: 'label', label: 'work-ready' } })
  record(journal, current, { type: 'invocation.reconciled', invocationId: 'surviving-model',
    evidence: { resources_settled_at: new Date().toISOString() } })
  expect(runtime.getBehaviorChainCapacity()).toMatchObject({ reservedModelInvocations: 0 })
  expect(journal.read(chain.id)!.invocations[0].state).toBe('uncertain')
})

it('reports unavailable capacity as unknown instead of free', async () => {
  const { db, runtime, chain } = await setup()
  db.db.prepare("UPDATE behavior_chain_current SET state = json_set(state, '$.held', 'unrecorded change') WHERE chain_id = ?").run(chain.id)
  expect(runtime.getBehaviorChainCapacity()).toMatchObject({ status: 'unavailable', reservedModelInvocations: null, enabled: null })
})

it('looks up a target beside 1,000 historical chains without loading their projections', async () => {
  const { db, journal, chain } = await setup()
  db.db.transaction(() => {
    for (let issue = 100; issue < 1100; issue++) {
      let historical = journal.append(chainIdentity(pr.repo, issue), `seed-${issue}`, 0, { type: 'chain.admitted', repository: pr.repo,
        issue, branch: `poise/issue-${issue}`, author: chain.author, reviewer: chain.reviewer })
      historical = record(journal, historical, { type: 'chain.observed', observation: { publication: { pull_number: issue + 1000 } } })
      record(journal, historical, { type: 'chain.merged', mergeSha: MERGE, evidence: { repository: pr.repo,
        pull_number: issue + 1000, merged: true, merge_sha: MERGE } })
    }
  })()
  const read = vi.spyOn(journal, 'read')
  expect(journal.forPull(pr.repo, pr.number)?.id).toBe(chain.id)
  expect(read).toHaveBeenCalledTimes(1)
  const plan = db.db.prepare(`EXPLAIN QUERY PLAN SELECT chain_id FROM behavior_chain_current
    WHERE lower(json_extract(state, '$.repository')) = lower(?)
      AND json_extract(state, '$.observation.publication.pull_number') = ? LIMIT 2`).all(pr.repo, pr.number) as Array<{ detail: string }>
  expect(plan.some((step) => step.detail.includes('behavior_chain_pull'))).toBe(true)
})

it('does not attribute another PR or a reused completed branch to a historical merge', async () => {
  const { journal, chain } = await setup()
  const identity = { headRef: chain.branch, headRepo: chain.repository }
  expect(() => journal.forPull(pr.repo, 18, identity)).toThrow('different published pull request')
  record(journal, chain, { type: 'chain.merged', mergeSha: MERGE, evidence: { repository: pr.repo,
    pull_number: pr.number, merged: true, merge_sha: MERGE } })
  expect(journal.forPull(pr.repo, pr.number)?.mergeSha).toBe(MERGE)
  expect(journal.forPull(pr.repo, 18, identity)).toBeNull()
})
