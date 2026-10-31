import Database from 'better-sqlite3'
import { BehaviorChainJournal } from '../../server/behavior-chain-store'
import { behaviorChainSummary } from '../../server/behavior-chain-summary'
import { CheckSemaphore } from '../../server/check-semaphore'

/** UI regression fixture: real isolated journal and production wire mapper,
 * never a behavior run or acceptance artifact. No global server DB is imported. */
export function chainSummaryFixture(state: 'pending-active' | 'pending-admitted' | 'pending-no-invocation' | 'complete' | 'historical') {
  const db = new Database(':memory:')
  try {
    const journal = new BehaviorChainJournal(db)
    const draining = journal.changeAdmission(0, 'draining')
    const cutover = journal.changeAdmission(draining.sequence, 'v2')
    let chain = journal.append('acme/repo#7', 'seed', 0, { type: 'chain.admitted', repository: 'acme/repo', issue: 7,
      branch: 'poise/issue-7', author: 'author', reviewer: 'reviewer' })
    chain = journal.append(chain.id, 'observed', chain.sequence, { type: 'chain.observed', observation: { publication: { pull_number: 17 } } })
    if (state === 'pending-active' || state === 'pending-admitted') {
      chain = journal.append(chain.id, 'admit', chain.sequence, { type: 'invocation.admitted', invocation: { id: 'original-work',
        behavior: 'repair-pr', actor: 'author', model: 'fixture', slot: 'primary', basis: 'repair', admittedAt: Date.now(),
        request: { command: 'agent-interface', cwd: '/isolated/fixture', argv: ['--atomic-work', 'acme/repo#7', '--model', 'fixture'] } } })
      if (state === 'pending-active') chain = journal.append(chain.id, 'uncertain', chain.sequence, {
        type: 'invocation.uncertain', invocationId: 'original-work', reason: 'original response missing' })
    }
    const pending = state.startsWith('pending')
    chain = journal.append(chain.id, 'merge', chain.sequence, { type: 'chain.merged', mergeSha: 'a'.repeat(40),
      evidence: { repository: chain.repository, pull_number: 17, merged: true, merge_sha: 'a'.repeat(40),
        ...(state === 'historical' ? {} : { review_complete: !pending }) } })
    if (state === 'pending-no-invocation') chain = journal.append(chain.id, 'held', chain.sequence, { type: 'chain.held',
      reason: 'qualifying original pre-merge review evidence is missing' })
    const before = journal.history(chain.id)
    journal.rebuild()
    const summary = behaviorChainSummary(journal.read(chain.id)!)
    const semaphore = new CheckSemaphore(() => 4)
    const processSlots = semaphore.stats()
    if (JSON.stringify(journal.history(chain.id)) !== JSON.stringify(before)) throw new Error('summary fixture changed historical authority')
    return { chains: [summary], next: null, runtime: [], cutover: { ...cutover, blockers: [] },
      settings: { enabled: false, seedMode: 'label', label: 'work-ready' },
      capacity: { status: 'available', reservedModelInvocations: journal.liveModelInvocationCount(), modelInvocationLimit: semaphore.laneCapacity('behavior'),
        processLocal: { behaviorRunning: processSlots.behaviorRunning, allRunning: processSlots.running, cap: processSlots.cap },
        enabled: false, mode: cutover.mode, intake: { seedMode: 'label', label: 'work-ready' } } }
  } finally { db.close() }
}
