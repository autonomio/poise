import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runOperator } from '../src/diagnostics/cli.js'
import { HostJournal } from '../src/diagnostics/host.js'
import { normalize } from '../src/diagnostics/contract.js'
import { DiagnosticStore } from '../src/diagnostics/store.js'
import { DiagnosticRuntime } from '../src/diagnostics/runtime.js'

const directories: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function directory() { const value = mkdtempSync(join(tmpdir(), 'poise-diagnostic-operation-')); directories.push(value); return value }

describe('independent operator health', () => {
  it('does not create a missing store when an operator asks to query', async () => {
    const path = directory(); vi.stubEnv('POISE_GATEWAY_DATA', path)
    await expect(runOperator(['query'], () => undefined)).rejects.toThrow()
    expect(existsSync(join(path, 'logging.db'))).toBe(false)
  })

  it('reports unavailable storage from the independent journal without leaking private source context', async () => {
    const path = directory(); vi.stubEnv('POISE_GATEWAY_DATA', path)
    writeFileSync(join(path, 'logging.db'), 'broken database')
    writeFileSync(join(path, 'logging.db.coverage.json'), JSON.stringify({ version: 1, stopped: false, writtenAt: new Date().toISOString(), sinkError: 'disk unavailable', dropped: 5,
      sources: [{ workspace: null, source: 'kernel', error: 'host source unavailable' }, { workspace: 'bob', source: 'caller', error: 'private-repository-cause' }] }))
    const lines: string[] = []; await runOperator(['health'], (line) => lines.push(line))
    const output = JSON.parse(lines[0]) as { status: string; journal: { dropped: number } }
    expect(output).toMatchObject({ status: 'unavailable', journal: { dropped: 5 } })
    expect(lines[0]).not.toContain('private-repository-cause')
  })
})

describe('native host collection without touching host journals', () => {
  it('retains multiline native causes, skips oversized/unrelated records and resumes a committed cursor', async () => {
    const path = directory(); const executable = join(path, 'journal-fixture'); const argsPath = join(path, 'args.json')
    const records = [
      { __CURSOR: 'cursor-a', __REALTIME_TIMESTAMP: '1792317600000000', PRIORITY: '3', _TRANSPORT: 'kernel', MESSAGE: 'kernel failure\nsecond causal line' },
      { __CURSOR: 'cursor-b', PRIORITY: '3', _SYSTEMD_UNIT: 'docker.service', MESSAGE: 'business-app image denied' },
      { __CURSOR: 'cursor-c', PRIORITY: '4', _SYSTEMD_UNIT: 'docker.service', MESSAGE: 'poise daemon network warning' },
    ]
    writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(argsPath)},JSON.stringify(process.argv.slice(2)));\nconst resumed=process.argv.includes('--after-cursor=cursor-c');\nif(!resumed) process.stdout.write('x'.repeat(100000)+'\\n');\nfor(const row of resumed?[{__CURSOR:'cursor-d',PRIORITY:3,_TRANSPORT:'kernel',MESSAGE:'new native cause'}]:${JSON.stringify(records)})process.stdout.write(JSON.stringify(row)+'\\n');\nsetInterval(()=>{},1000)\n`)
    chmodSync(executable, 0o700)
    const runtime = new DiagnosticRuntime({ path: join(path, 'logging.db'), report: () => undefined })
    const first = new HostJournal(runtime, executable)
    first.start()
    try {
      await vi.waitFor(() => expect(runtime.query((db) => db.checkpoint('host-journal'))).toBe('cursor-c'))
      const page = runtime.query((db) => db.query({ workspace: 'operator', operator: true }))
      expect(page.events.filter((event) => event.source === 'kernel' || event.source === 'docker')).toHaveLength(2)
      expect(JSON.stringify(page)).not.toContain('business-app')
      expect(page.events.some((event) => event.message === 'kernel failure\nsecond causal line' && event.severity === 'error')).toBe(true)
      expect(runtime.health().sources[0].gaps.length).toBeGreaterThan(0)
    } finally { first.stop() }
    const resumed = new HostJournal(runtime, executable)
    resumed.start()
    try {
      await vi.waitFor(() => expect(runtime.query((db) => db.checkpoint('host-journal'))).toBe('cursor-d'))
      const args = JSON.parse(readFileSync(argsPath, 'utf8')) as string[]
      for (const flag of ['--after-cursor=cursor-c', '--all', '--no-tail', '_TRANSPORT=kernel', '_SYSTEMD_UNIT=docker.service']) expect(args).toContain(flag)
      expect(runtime.query((db) => db.query({ workspace: 'operator', operator: true }, { source: 'kernel' })).total).toBe(2)
    } finally { resumed.stop(); runtime.stop() }
  })
})

it('reports fresh source failures and recorded loss as partial operator coverage', async () => {
  const path = directory(); vi.stubEnv('POISE_GATEWAY_DATA', path)
  const db = new DiagnosticStore(join(path, 'logging.db')); db.close()
  for (const state of [{ reportError: 'reporting unavailable', sources: [] }, { coverageError: 'coverage persistence unavailable', sources: [] }, { dropped: 1, sources: [] }, { rejected: 1, sources: [] }, { dropped: 0, sources: [{ workspace: null, status: 'unavailable' }] }]) {
    writeFileSync(join(path, 'logging.db.coverage.json'), JSON.stringify({ version: 1, stopped: false, writtenAt: new Date().toISOString(), sinkError: null, ...state }))
    const lines: string[] = []; await runOperator(['health'], (line) => lines.push(line))
    expect(JSON.parse(lines[0]).status).toBe('partial')
  }
})

it('preserves ingress Unicode split between stdin chunks', async () => {
  const path = directory(); vi.stubEnv('POISE_GATEWAY_DATA', path); vi.stubEnv('POISE_DOMAIN', 'poise.test')
  const bytes = Buffer.from(JSON.stringify({ request: { host: 'poise.test' }, level: 'error', msg: 'native 障 cause' }))
  const split = bytes.indexOf(Buffer.from('障')) + 1
  async function* chunks() { yield bytes.subarray(0, split); yield bytes.subarray(split) }
  const lines: string[] = []; await runOperator(['ingress'], (line) => lines.push(line), chunks())
  await runOperator(['query'], (line) => lines.push(line))
  expect(JSON.parse(lines[1]).events[0].message).toBe('native 障 cause')
})

it('advances past an oversized host record under the minimum storage budget', async () => {
  const path = directory(); const executable = join(path, 'journal-fixture')
  const rows = [{ __CURSOR: 'large', PRIORITY: 3, _TRANSPORT: 'kernel', MESSAGE: 'x'.repeat(2500) }, { __CURSOR: 'later', PRIORITY: 3, _TRANSPORT: 'kernel', MESSAGE: 'later native cause' }]
  writeFileSync(executable, `#!${process.execPath}\nfor(const row of ${JSON.stringify(rows)})process.stdout.write(JSON.stringify(row)+'\\n');setInterval(()=>{},1000)\n`)
  chmodSync(executable, 0o700)
  const runtime = new DiagnosticRuntime({ path: join(path, 'logging.db'), policy: { maxBytes: 4096, maxEvents: 100, retentionMs: 86400000 }, report: () => undefined })
  runtime.query((db) => db.commitDelivery([], 'host-journal', 'existing'))
  const host = new HostJournal(runtime, executable); host.start()
  try {
    await vi.waitFor(() => expect(runtime.query((db) => db.checkpoint('host-journal'))).toBe('later'))
    expect(runtime.query((db) => db.query({ workspace: 'operator', operator: true })).events.some((event) => event.message === 'later native cause')).toBe(true)
    expect(runtime.health().rejected).toBeGreaterThan(0)
  } finally { host.stop(); runtime.stop() }
})

it('gives host operator commands no workspace identity, including a real owner named operator', async () => {
  const path = directory(); vi.stubEnv('POISE_GATEWAY_DATA', path)
  const db = new DiagnosticStore(join(path, 'logging.db'))
  const privateEvent = normalize({ id: 'private-operator-account', level: 'error', source: 'caller', workspace: 'operator', operation: 'private.failure', message: 'owner-only-cause' })!
  db.append([privateEvent]); db.coverage({ id: 'private', source: 'caller', workspace: 'operator', status: 'unavailable', observedAt: null,
    ingestedAt: null, availableFrom: null, error: 'owner-only-coverage', gaps: [] }); db.close()
  const lines: string[] = []
  for (const args of [['query'], ['export'], ['event', privateEvent.id], ['health']]) await runOperator(args, (line) => lines.push(line))
  expect(JSON.parse(lines[0]).total).toBe(0)
  expect(JSON.stringify(lines)).not.toContain('owner-only-cause')
  expect(JSON.stringify(lines)).not.toContain('owner-only-coverage')
  expect(JSON.parse(lines[2]).status).toBe('unavailable')
})
