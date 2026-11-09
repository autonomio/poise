import { generateKeyPairSync, randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { signAssertion } from '../gateway/src/assertion'
import { readWorkCursor, signWorkCursor, type McpGrantScope } from '../gateway/src/mcp-contract'
import { mcpIssues, MCP_HEAD, MCP_MERGE, MCP_REPO, seedMcpChains } from './fixtures/mcp-work'
import type { LedgerHealth } from '../server/behavior-ledger-contract'
import { send, startHarness } from '../gateway/tests/harness'
import { createGateway } from '../gateway/src/gateway'
import { connectPoise, tool } from '../deploy/ci/mcp-client.mjs'
import { verifyIdentityAssertion } from '../server/service/identity'

const mocks = vi.hoisted(() => ({ run: vi.fn(), ledger: vi.fn() }))
vi.mock('../server/process', () => ({ runFile: mocks.run, MAX_PROCESS_ARG_BYTES: 65536 }))
vi.mock('../server/behavior-ledger', () => ({ readBehaviorLedger: mocks.ledger }))
vi.mock('../server/organizations', () => {
  const org = { login: 'fixtures', status: 'ready', managed: false }
  return { getOrganizations: () => [org], readyOrganizations: () => [org], organizationForRepository: () => org, organizationArgs: (_org: unknown, args: string[]) => args }
})

const keys = generateKeyPairSync('ed25519')
const scope: McpGrantScope = { resource: 'https://poise.test/mcp', ownerId: 1001, handle: 'alice', grantId: randomUUID() }
let server: http.Server
let port: number
let stale = false, partial = false
let records = mcpIssues()
interface WorkBody {
  rows: { issue: number; github: { ci: { head?: string } | null }; invocations: { state: string; receipt: string; callId: string | null }[] }[]
  nextAfter: { repository: string; number: number } | null
  coverage: { status: string }
}
const health = (): LedgerHealth => ({ status: partial ? 'incomplete' : 'ok', unavailableReason: null, coverageStart: new Date(Date.now() - 3600_000).toISOString(),
  observedAt: new Date().toISOString(), callerObservedAt: new Date().toISOString(), pending: 0, dropped: partial ? 1 : 0,
  gaps: partial ? [{ since: new Date().toISOString(), until: null, reason: 'capture_loss' }] : [], detailFloor: null, generation: 'fixture',
  retainedFrom: new Date(Date.now() - 3600_000).toISOString(), changeLowerBound: 0, lastSequence: 1, instances: 0, changes: 0 })

beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('POISE_DB', ':memory:'); stale = false; partial = false; records = mcpIssues()
  mocks.run.mockImplementation(async (command: string, args: string[]) => {
    expect(command).toBe('github-datastore')
    if (args[0] === 'health') {
      const stdout = JSON.stringify({ healthy: !stale, last_success_at: new Date(Date.now() - (stale ? 600_000 : 0)).toISOString() })
      if (stale) throw Object.assign(new Error('stale'), { stdout })
      return { stdout, stderr: '' }
    }
    expect(args.slice(0, 4)).toEqual(['view', 'issue', '--repo', MCP_REPO.toLowerCase()])
    expect(args).not.toContain('--username'); expect(args).not.toContain('--author')
    const issue = args.indexOf('--number'), after = args.indexOf('--after-number'), limit = Number(args[args.indexOf('--limit') + 1])
    return { stdout: JSON.stringify(records.filter(row => issue >= 0 ? row.number === Number(args[issue + 1]) : row.number > Number(args[after + 1])).slice(0, limit)), stderr: '' }
  })
  mocks.ledger.mockImplementation(async () => ({ status: 200, body: { version: 1, health: health(), records: [], hasMore: false } }))
  const database = await import('../server/db')
  database.setMeta('me', 'alice'); database.setMeta('agentAccount', 'review-bot')
  seedMcpChains(database.db)
  const { enforceApiRequest, httpStatus } = await import('../server/http')
  const { handleMcpRead } = await import('../server/mcp')
  const service = { handle: 'alice', owner: 'Alice', ownerId: 1001, publicOrigin: 'https://alice.poise.test', publicProtocol: 'https:' as const,
    publicHost: 'alice.poise.test', gatewayKey: keys.publicKey, drainTimeoutSeconds: 5400 }
  server = http.createServer(async (req, res) => {
    try { await handleMcpRead(req, res, service, enforceApiRequest(req, { service })) }
    catch (error) { res.statusCode = httpStatus(error, 400); res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); port = (server.address() as AddressInfo).port
})
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs() })

async function request(args: Record<string, unknown>, token = signAssertion(keys.privateKey, { handle: 'alice', login: 'Alice', scope: 'mcp', mcp: scope }, Date.now()), name = 'poise_work') {
  const reply = await send(port, { host: 'alice.poise.test', path: '/api/mcp/read', method: 'POST', headers: { 'content-type': 'application/json', 'x-poise-identity': token },
    body: JSON.stringify({ name, arguments: args }) })
  return { ...reply, json: () => reply.json<WorkBody>() }
}

it('includes a third-party labelled issue with no owner involvement, chain or Call in a bounded issue-driven page', async () => {
  const response = await request({ repository: MCP_REPO, label: 'poise', limit: 2 })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.rows[0]).toMatchObject({ issue: 1, author: 'third-party', chainId: null, calls: [], invocations: [], stage: 'not_started', reviewStatus: 'not-recorded' })
  expect(body.rows[1]).toMatchObject({ issue: 2, stage: 'delayed', reason: 'waiting for native capacity' })
  expect(body.nextAfter).toEqual({ repository: MCP_REPO, number: 2 })
  const query = mocks.run.mock.calls.find(([, args]) => args[0] === 'view')![1]
  expect(query).toEqual(['view', 'issue', '--repo', MCP_REPO.toLowerCase(), '--format', 'json', '--limit', '3', '--status', 'open', '--label', 'poise', '--after-repo', '', '--after-number', '0'])
  expect(mocks.ledger.mock.calls.map(([read]) => read)).toEqual([1, 2].map(number => ({ operation: 'list', repository: MCP_REPO.toLowerCase(), number, limit: 3 })))
})

it('runs the SDK client through discovery, OAuth, initialize and both tools across the actual signed HTTP boundary', async () => {
  const h = await startHarness({ env: { POISE_MCP_ENABLED: '1' } })
  const gateway = createGateway({ ...h.context.deps, keys: { privateKey: keys.privateKey,
    publicKeyBase64: Buffer.from(keys.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64') },
    upstream: () => ({ host: '127.0.0.1', port }) })
  await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve))
  const gatewayPort = (gateway.server.address() as AddressInfo).port
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname !== 'poise.test') return fetch(input, init)
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    const reply = await send(gatewayPort, { host: 'poise.test', path: `${url.pathname}${url.search}`, method: init?.method,
      headers, ...(init?.body ? { body: String(init.body) } : {}) })
    const responseHeaders = new Headers()
    for (const [key, value] of Object.entries(reply.headers)) {
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(key, entry)
    }
    return new Response(reply.status === 202 ? null : reply.body, { status: reply.status, headers: responseHeaders })
  }
  try {
    h.github.signInAs('Alice')
    const connection = await connectPoise('https://poise.test/mcp', 'alice', fetcher)
    try {
      expect(await tool(connection.client, 'poise_describe')).toMatchObject({ workspace: 'alice', owner: 'Alice' })
      expect(await tool(connection.client, 'poise_work', { repository: MCP_REPO, issue: 4 })).toMatchObject({ rows: [{ mergeSha: MCP_MERGE, reviewStatus: 'pending' }] })
      expect(h.workspace.requests).toHaveLength(0)
    } finally { await connection.client.close() }
  } finally { await gateway.close(); await h.close() }
})

it('preserves actual merge SHA and pending versus completed Poise review, independently of a missing receipt', async () => {
  for (const [issue, stage, reviewStatus] of [[3, 'completed', 'complete'], [4, 'merged_review_pending', 'pending'], [5, 'held', 'not-recorded']] as const) {
    const body = await (await request({ repository: MCP_REPO, issue })).json()
    expect(body.rows[0]).toMatchObject({ issue, stage, reviewStatus, mergeSha: issue === 5 ? null : MCP_MERGE })
    expect(body.rows[0].github.ci).toMatchObject({ head: MCP_HEAD })
    if (issue !== 3) expect(body.rows[0].invocations[0]).toMatchObject({ state: 'uncertain', receipt: 'not-recorded', callId: null })
  }
})

it('reports stale mirrors separately from missing Caller coverage and does not infer absence under a partial source', async () => {
  stale = true
  const staleBody = await (await request({ repository: MCP_REPO, issue: 1 })).json()
  expect(staleBody).toMatchObject({ coverage: { status: 'stale' }, rows: [{ stage: 'unknown', coverage: { calls: { status: 'fresh' } } }] })
  stale = false; partial = true; records = []
  const partialBody = await (await request({ repository: MCP_REPO, issue: 1 })).json()
  expect(partialBody.rows[0]).toMatchObject({ stage: 'unknown', coverage: { calls: { status: 'partial' } } })
  mocks.run.mockRejectedValueOnce(new Error('mirror unavailable'))
  expect((await (await request({ repository: MCP_REPO, issue: 1 })).json()).coverage.status).toBe('unavailable')
})

it('binds stable keyset cursors to owner, workspace, grant, resource and query; rejects tampering before reading', async () => {
  const read = { repository: MCP_REPO.toLowerCase(), label: 'poise', limit: 2 }
  const cursor = signWorkCursor(keys.privateKey, scope, read, { repository: MCP_REPO, number: 2 })
  expect(readWorkCursor(keys.publicKey, scope, { ...read, cursor }).number).toBe(2)
  const page = await (await request({ ...read, cursor })).json()
  expect(page.rows.map((row: { issue: number }) => row.issue)).toEqual([3, 4])
  for (const changed of [{ ...scope, ownerId: 1002 }, { ...scope, handle: 'bob' }, { ...scope, grantId: randomUUID() }, { ...scope, resource: 'https://other.test/mcp' }]) {
    expect(() => readWorkCursor(keys.publicKey, changed, { ...read, cursor })).toThrow()
  }
  expect((await request({ ...read, cursor: cursor.slice(0, -5) + 'abcde' })).status).toBe(400)
  expect((await request({ ...read, label: 'other', cursor })).status).toBe(400)
})

it('admits only a signed MCP read assertion for this owner, resource, workspace and typed tool', async () => {
  const valid = signAssertion(keys.privateKey, { handle: 'alice', login: 'Alice', scope: 'mcp', mcp: scope }, Date.now())
  expect(verifyIdentityAssertion(valid, { key: keys.publicKey, handle: 'alice', owner: 'Alice', resource: scope.resource }, Date.now() / 1000).ok).toBe(false)
  for (const subject of [
    { handle: 'bob', login: 'bob', scope: 'mcp' as const, mcp: { ...scope, handle: 'bob', ownerId: 1002 } },
    { handle: 'alice', login: 'mallory', scope: 'mcp' as const, mcp: scope },
    { handle: 'alice', login: 'Alice', scope: 'mcp' as const, mcp: { ...scope, ownerId: 1002 } },
    { handle: 'alice', login: 'Alice', scope: 'mcp' as const, mcp: { ...scope, resource: 'https://other.test/mcp' } },
    { handle: 'alice', login: 'Alice', scope: 'browser' as const },
    { handle: 'alice', login: 'Alice', scope: 'admin' as const },
  ]) expect((await request({}, signAssertion(keys.privateKey, subject, Date.now()), 'poise_describe')).status).toBeGreaterThanOrEqual(400)
  expect((await request({}, 'forged', 'poise_describe')).status).toBe(401)
  expect((await request({}, signAssertion(keys.privateKey, { handle: 'alice', login: 'Alice', scope: 'mcp', mcp: scope }, Date.now() - 300_000), 'poise_describe')).status).toBe(401)
  expect((await request({}, undefined, 'terminal')).status).toBe(400)
  expect((await request({ repository: 'other/private', issue: 1 })).status).toBe(400)
  const description = await (await request({}, undefined, 'poise_describe')).json()
  expect(description).toMatchObject({ workspace: 'alice', grant: { scope: 'poise:read', tools: ['poise_describe', 'poise_work'] } })
})
