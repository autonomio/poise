import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runFile: vi.fn() }))
vi.mock('../server/process', () => ({ runFile: mocks.runFile }))
vi.mock('../server/organizations', () => ({ readyOrganizations: () => [{ login: 'acme', status: 'ready' }],
  organizationArgs: (_organization: unknown, args: string[]) => args }))

let root: string
let database: typeof import('../server/db')
let capacity: typeof import('../server/worker-capacity')
let alerts: typeof import('../server/alerts/store')
let issues: Array<{ repo: string, number: number }>
let candidates: Array<{ repository: { nameWithOwner: string }, number: number, title: string, url: string, labels: [] }>
const minute = 60_000
let began: number

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'poise-capacity-chain-'))
  vi.stubEnv('POISE_DB', join(root, 'cache.db'))
  vi.resetModules()
  database = await import('../server/db')
  capacity = await import('../server/worker-capacity')
  alerts = await import('../server/alerts/store')
  database.setMeta('manager_settings', JSON.stringify({ rhythm: 4, scope: null, paused: false }))
  capacity.setWorkerChatReader(() => ({ running: 1, hasManager: true, boundTargets: [] }))
  issues = []; candidates = []; began = Date.now()
  mocks.runFile.mockReset().mockImplementation(async (command: string, args: string[]) => {
    if (command === 'github-datastore' && args[0] === 'view') return { stdout: JSON.stringify(issues) }
    if (command === 'gh' && args[0] === 'search') return { stdout: JSON.stringify(candidates) }
    throw new Error(`unexpected capacity operation ${command}`)
  })
})
afterEach(async () => {
  database.closeDatabase()
  vi.unstubAllEnvs()
  vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

async function own(number: number) {
  const { behaviorChainJournal } = await import('../server/behavior-chain-journal')
  const journal = behaviorChainJournal()
  return journal.append(`acme/api#${number}`, `seed-${number}`, 0, { type: 'chain.admitted', repository: 'acme/api', issue: number,
    branch: `poise/issue-${number}`, author: 'author', reviewer: 'reviewer' })
}
function candidate(number: number) {
  return { repository: { nameWithOwner: 'acme/api' }, number, title: `Candidate ${number}`,
    url: `https://github.com/acme/api/issues/${number}`, labels: [] as [] }
}

it('excludes proven chain ownership from the labelled Manager backlog without counting it as a Chat binding', async () => {
  await own(7)
  issues = [{ repo: 'acme/api', number: 7 }, { repo: 'acme/api', number: 8 }, { repo: 'acme/api', number: 9 }]
  capacity.setWorkerChatReader(() => ({ running: 1, hasManager: true, boundTargets: ['https://github.com/acme/api/issues/9'] }))
  expect(await capacity.refreshWorkerCapacity({ now: began })).toMatchObject({ backlog: 1, label: 'enhancement' })
  expect(mocks.runFile.mock.calls.every(([command]) => command === 'github-datastore')).toBe(true)
})

it('never suggests labelling an issue that already belongs to a chain', async () => {
  await own(7)
  issues = [{ repo: 'acme/api', number: 7 }]
  candidates = [candidate(7), candidate(8)]
  await capacity.refreshWorkerCapacity({ now: began })
  await capacity.refreshWorkerCapacity({ now: began + 16 * minute })
  const open = alerts.openAlerts({ now: began + 16 * minute })
  expect(open).toHaveLength(1)
  expect(open[0].body).toContain('/issues/8')
  expect(open[0].body).not.toContain('/issues/7')
})

it('invalidates a cached suggestion when that issue acquires durable chain ownership', async () => {
  candidates = [candidate(8)]
  await capacity.refreshWorkerCapacity({ now: began })
  await capacity.refreshWorkerCapacity({ now: began + 16 * minute })
  expect(alerts.openAlerts({ now: began + 16 * minute })[0].body).toContain('/issues/8')
  await own(8)
  candidates = [candidate(8), candidate(10)]
  await capacity.refreshWorkerCapacity({ now: began + 17 * minute })
  const open = alerts.openAlerts({ now: began + 17 * minute })
  expect(open[0].body).not.toContain('/issues/8')
  expect(open[0].body).toContain('/issues/10')
  expect(mocks.runFile.mock.calls.filter(([command]) => command === 'gh')).toHaveLength(2)
})

it('keeps missing Chat occupancy unknown and does not clear an existing idle incident from absence', async () => {
  await capacity.refreshWorkerCapacity({ now: began })
  await capacity.refreshWorkerCapacity({ now: began + 16 * minute })
  expect(alerts.openAlerts({ now: began + 16 * minute })).toHaveLength(1)
  capacity.setWorkerChatReader(() => { throw new Error('Chat reader unavailable') })
  expect(await capacity.refreshWorkerCapacity({ now: began + 17 * minute })).toMatchObject({ running: null })
  expect(capacity.getWorkerCapacity().running).toBeNull()
  expect(alerts.openAlerts({ now: began + 17 * minute })).toHaveLength(1)
})
