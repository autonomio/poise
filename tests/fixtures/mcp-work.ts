import type Database from 'better-sqlite3'
import { BehaviorChainJournal, chainBasis, chainIdentity, type ChainEvent } from '../../server/behavior-chain-store'
import type { ChainObservation } from '../../server/behavior-chain-decision'
import { completedReviewCall } from '../review-response-fixture'

export const MCP_REPO = 'fixtures/Work'
export const MCP_HEAD = 'a'.repeat(40)
export const MCP_MERGE = 'b'.repeat(40)

export function mcpIssues(now = Date.now()) {
  return [1, 2, 3, 4, 5].map(number => ({ repo: MCP_REPO, number, status: 'open' as const, author: 'third-party',
    created_at: new Date(now - 60_000).toISOString(), updated_at: new Date(now - 30_000).toISOString(), closed_at: null,
    title: `Fixture issue ${number}`, url: `https://github.com/${MCP_REPO}/issues/${number}`, comments_count: 0 }))
}

/** Native journal evidence shared by adapter and disposable deployment acceptance. Issue 1 has no chain or Call. */
export function seedMcpChains(database: Database.Database, now = Date.now()) {
  const journal = new BehaviorChainJournal(database)
  for (const issue of [2, 3, 4, 5]) {
    let chain = journal.append(chainIdentity(MCP_REPO, issue), `mcp-seed-${issue}`, 0,
      { type: 'chain.admitted', repository: MCP_REPO, issue, branch: `poise/issue-${issue}`, author: 'alice', reviewer: 'review-bot' })
    const append = (event: ChainEvent) => { chain = journal.append(chain.id, `${chain.id}:${chain.sequence}`, chain.sequence, event, now) }
    const reviewer = { slot: 'primary', model: 'fixture', recovery: 'fixture' }
    const observation: ChainObservation = { checkedAt: now, issue: { open: true, revision: 'fixture', eligible: true, commentIds: [] },
      issueReviewers: [], prReviewers: [reviewer], implementer: reviewer, repairer: reviewer, approver: reviewer, existingPulls: [],
      publication: { pull_number: issue + 10, head_sha: MCP_HEAD, head_invocation: null, state: 'open', merged: false, merge_sha: null },
      pull: { number: issue + 10, head: MCP_HEAD, headSince: now - 60_000, state: 'open', draft: false, merged: false, mergeSha: null,
        queueEntry: null, queueRemoval: null, changesRequested: false, unresolved: 0, approved: false, ready: false,
        reviewIds: [], reviewReceipts: [], reviewContext: 'b'.repeat(64), reviewRevision: 'fixture', greyRuns: [],
        checksState: 'PENDING', pending: true, failing: [], conflict: false, behind: false } }
    if (issue === 2) { observation.pull = null; observation.publication.pull_number = null }
    append({ type: 'chain.observed', observation })
    if (issue === 2) { append({ type: 'chain.waiting', reason: 'waiting for native capacity' }); continue }
    if (issue === 3) {
      const call = completedReviewCall(MCP_REPO, issue + 10, MCP_HEAD, 'review-bot')
      const response = call.artifact!.review_response as { context_sha: string }
      append({ type: 'invocation.admitted', invocation: { id: 'completed-review', behavior: 'review-pr', actor: 'review-bot', model: 'fixture',
        slot: 'primary', basis: chainBasis(['pr', MCP_HEAD, response.context_sha]), admittedAt: Date.parse(call.started_at),
        request: { command: 'agent-interface', cwd: '/fixture', argv: [] } } })
      append({ type: 'invocation.settled', invocationId: 'completed-review', callId: call.id, outcome: 'clean',
        evidence: { status: 'completed', action: 'reviewed_clean', review_id: call.review_id, head_sha: MCP_HEAD,
          completedAt: Date.parse(call.completed_at!), artifact: call.artifact } })
      Object.assign(observation.pull!, { reviewIds: [call.review_id!], approved: true,
        reviewReceipts: [{ id: call.review_id!, head: MCP_HEAD, state: 'COMMENTED', invocation: call.id, response, submittedAt: Date.parse(call.completed_at!) }] })
    } else {
      append({ type: 'invocation.admitted', invocation: { id: `missing-original-${issue}`, behavior: issue === 4 ? 'merge-pr' : 'implement-issue',
        actor: 'review-bot', model: issue === 4 ? null : 'fixture', slot: null, basis: 'fixture', admittedAt: now - 60_000,
        request: { command: issue === 4 ? 'github-interface' : 'agent-interface', cwd: '/fixture', argv: [] } } })
      append({ type: 'invocation.uncertain', invocationId: `missing-original-${issue}`, reason: 'original response missing' })
    }
    if (issue === 5) continue
    Object.assign(observation.pull!, { merged: true, mergeSha: MCP_MERGE, state: 'closed', mergedAt: Date.now() + 1, pending: false, checksState: 'SUCCESS' })
    Object.assign(observation.publication, { merged: true, merge_sha: MCP_MERGE, state: 'closed' })
    append({ type: 'chain.observed', observation })
    append({ type: 'chain.merged', mergeSha: MCP_MERGE, evidence: { repository: MCP_REPO, pull_number: issue + 10,
      merged: true, merge_sha: MCP_MERGE, review_complete: issue === 3 } })
  }
  return journal
}
