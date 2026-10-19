import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { startIngressSocket } from '../src/diagnostics/ingress-ipc.js'
import { DiagnosticRuntime } from '../src/diagnostics/runtime.js'
import { DiagnosticStore } from '../src/diagnostics/store.js'
import { executeLoggingRead } from '../src/diagnostics/query-worker.js'

const cleanups: Array<() => Promise<void>> = []
beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: resolve('.'), timeout: 15_000, stdio: 'pipe' })
  execFileSync(process.execPath, ['deploy/ingress/build.mjs'], { cwd: resolve('..'), timeout: 15_000, stdio: 'pipe' })
}, 30_000)
afterEach(async () => { for (const stop of cleanups.splice(0)) await stop() })
async function writer() {
  const directory = mkdtempSync(join(tmpdir(), 'poise-ingress-ipc-'))
  const path = join(directory, 'logging.db'), socket = join(directory, 'logging.ingress.sock')
  const runtime = new DiagnosticRuntime({ path, report: () => undefined })
  const server = await startIngressSocket(runtime, socket, 'poise.test', true)
  runtime.observe('gateway', 'gateway', null); runtime.start()
  cleanups.push(async () => { await server.close(); runtime.stop(); rmSync(directory, { recursive: true, force: true }) })
  return { directory, path, socket, runtime }
}
function cli(directory: string, command: string, payload: string | ((hello: Record<string, unknown>) => string)) {
  return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/diagnostics/cli.js', command], { env: { ...process.env, POISE_GATEWAY_DATA: directory, POISE_DOMAIN: 'poise.test' }, stdio: ['pipe', 'pipe', 'pipe'] })
    const lines: Array<Record<string, unknown>> = []; let pending = '', error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Compiled ingress CLI stalled')) }, 10_000)
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = JSON.parse(pending.slice(0, end)) as Record<string, unknown>; pending = pending.slice(end + 1); lines.push(line)
        if (lines.length === 1 && typeof payload === 'function') child.stdin.end(payload(line))
      }
    })
    child.on('error', reject)
    child.on('close', (code) => { clearTimeout(timer); if (code || pending) reject(new Error(error || 'Compiled CLI did not acknowledge')); else resolve(lines) })
    if (typeof payload === 'string') child.stdin.end(payload)
  })
}

it('runs the compiled operator command through one writer while gateway diagnostics continue', async () => {
  const w = await writer()
  expect(statSync(w.socket).mode & 0o777).toBe(0o600)
  let emitted = 0
  const concurrent = setInterval(() => { w.runtime.emit({ id: 'active-' + emitted++, source: 'gateway', operation: 'busy', level: 'error', message: 'concurrent retained cause' }); w.runtime.flush() }, 5)
  try {
    const lines = await cli(w.directory, 'ingress-stream', (hello) => JSON.stringify({ version: 1, challenge: hello.challenge, expected: hello.checkpoint,
      container: 'a'.repeat(64), from: new Date(Date.now() - 1000).toISOString(), until: new Date().toISOString(), state: 'complete', records: [] }))
    expect(lines[1]).toMatchObject({ accepted: true, currentStatus: 'connected' })
    expect(emitted).toBeGreaterThan(0)
    w.runtime.flush()
    expect(w.runtime.health()).toMatchObject({ error: null, dropped: 0, rejected: 0 })
    expect(w.runtime.health().sources.find((source) => source.id === 'external-ingress')).toMatchObject({ currentStatus: 'connected' })
    const journal = JSON.parse(readFileSync(w.path + '.coverage.json', 'utf8')) as { sources: Array<{ id: string }> }
    expect(journal.sources.some((source) => source.id === 'external-ingress')).toBe(false)
    const page = executeLoggingRead({ path: w.path, policy: w.runtime.health().policy, now: Date.now(), operation: 'health', access: { workspace: null, operator: true }, filter: {} })
    expect(JSON.parse(page.body).collection.sources.find((source: { id: string }) => source.id === 'external-ingress').currentStatus).toBe('connected')
  } finally { clearInterval(concurrent) }
})

it('preserves the legacy manual identity and refuses strict-host violations at the compiled boundary', async () => {
  const w = await writer()
  const text = JSON.stringify({ request: { host: 'alice.poise.test' }, ts: Date.now() / 1000, level: 'error', msg: 'native cause', request_id: 'same-request' })
  const first = await cli(w.directory, 'ingress', text), second = await cli(w.directory, 'ingress', text)
  expect(second[0].eventId).toBe(first[0].eventId)
  const db = new DiagnosticStore(w.path, undefined, Date.now, true)
  try { expect(db.query({ workspace: null, operator: true }).total).toBe(1); expect(db.query({ workspace: 'alice', operator: false }).total).toBe(0) }
  finally { db.close() }
  for (const host of ['admin.poise.test', 'nested.alice.poise.test', 'alice.poise.test:99999', 'poise.test.attacker.test']) {
    await expect(cli(w.directory, 'ingress', JSON.stringify({ request: { host }, level: 'error', msg: 'excluded' }))).rejects.toThrow()
  }
})
