import { createServer } from 'node:http'
import { afterAll, expect, it, vi } from 'vitest'
import { db, setMeta, closeDatabase } from '../server/db'
import { behaviorChainJournal } from '../server/behavior-chain-journal'

vi.mock('../server/behaviors', () => ({ getBehaviorChainRuntimeHealth: () => [],
  getBehaviorChainCapacity: () => ({ status: 'available', reservedModelInvocations: 0, modelInvocationLimit: 3,
    enabled: false, intake: { seedMode: 'label', label: 'poise' } }) }))
const { handleBehaviorChains } = await import('../server/behavior-chain-api')
afterAll(() => closeDatabase())

it('reports durable cutover through the real HTTP handler and refuses stale or invalid controls', async () => {
  const server = createServer((req, res) => { void handleBehaviorChains(req, res, req.url || '/') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not bind')
  const base = `http://127.0.0.1:${address.port}/api/behavior-chains`
  const post = (body: unknown) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post({ operation: 'switch-to-v2', sequence: 0 })).status).toBe(409)
    setMeta('me', 'author'); setMeta('agentAccount', 'reviewer')
    expect((await post({ operation: 'switch-to-v2' })).status).toBe(400)
    const response = await post({ operation: 'switch-to-v2', sequence: 0 })
    expect(response.status).toBe(200)
    const drain = await response.json()
    expect(drain.cutover.mode).toBe('draining')
    expect((await post({ operation: 'cancel-cutover', sequence: 0 })).status).toBe(409)
    const read = await (await fetch(base)).json()
    expect(read.cutover.sequence).toBe(drain.cutover.sequence)
    expect((await post({ operation: 'cancel-cutover', sequence: drain.cutover.sequence })).status).toBe(200)
    expect(behaviorChainJournal().cutover().mode).toBe('v1')
    expect(db.prepare('SELECT count(*) AS n FROM behavior_chain_current').get()).toEqual({ n: 0 })
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})

it('keeps a confirmed merge with an open review obligation active through API reads and controls', async () => {
  const journal = behaviorChainJournal()
  let pending = journal.append('api/repo#7', 'pending-seed', 0, { type: 'chain.admitted', repository: 'api/repo', issue: 7,
    branch: 'poise/issue-7', author: 'author', reviewer: 'reviewer' })
  pending = journal.append(pending.id, 'pending-merge', pending.sequence, { type: 'chain.merged', mergeSha: 'a'.repeat(40),
    evidence: { repository: pending.repository, pull_number: 17, merged: true, merge_sha: 'a'.repeat(40), review_complete: false } })
  let complete = journal.append('api/repo#8', 'complete-seed', 0, { type: 'chain.admitted', repository: 'api/repo', issue: 8,
    branch: 'poise/issue-8', author: 'author', reviewer: 'reviewer' })
  complete = journal.append(complete.id, 'complete-merge', complete.sequence, { type: 'chain.merged', mergeSha: 'b'.repeat(40),
    evidence: { repository: complete.repository, pull_number: 18, merged: true, merge_sha: 'b'.repeat(40) } })
  const server = createServer((req, res) => { void handleBehaviorChains(req, res, req.url || '/') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not bind')
  const base = `http://127.0.0.1:${address.port}/api/behavior-chains`
  try {
    const active = await (await fetch(`${base}?state=active`)).json()
    expect(active.chains).toEqual([expect.objectContaining({ id: pending.id, mergeSha: 'a'.repeat(40), reviewPending: true })])
    const merged = await (await fetch(`${base}?state=merged`)).json()
    expect(merged.chains).toEqual([expect.objectContaining({ id: complete.id, mergeSha: 'b'.repeat(40), reviewPending: false })])
    const detail = await (await fetch(`${base}?id=${encodeURIComponent(pending.id)}`)).json()
    expect(detail.chain.reviewPending).toBe(true)
    const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pending.id, sequence: pending.sequence, operation: 'hold' }) })
    expect(response.status).toBe(200)
    expect((await response.json()).chain).toMatchObject({ reviewPending: true, held: 'New invocations held by the person' })
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})
