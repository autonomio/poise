import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { captureRuntimeCommand, recordRuntimeDiagnostic } from '../server/runtime-diagnostic'
import { DiagnosticStore } from '../gateway/src/diagnostics/store'
import type { LogEvent } from '../gateway/src/diagnostics/contract'

const directories: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function path() { const directory = mkdtempSync(join(tmpdir(), 'poise-bootstrap-diagnostics-')); directories.push(directory); return join(directory, 'logging.db') }

it('retains bootstrap stderr and source measurements without arguments, stdout or credentials', async () => {
  const storePath = path(); const events: LogEvent[] = []
  vi.stubEnv('POISE_TEST_TOKEN', 'opaque-bootstrap-credential')
  const code = await captureRuntimeCommand(process.execPath, ['-e', "process.stdout.write('private-output');process.stderr.write('fatal: precise cause\\nopaque-bootstrap-credential');process.exit(9)", 'private-argument'],
    { path: storePath, workspace: 'alice', quiet: true, write: (event) => events.push(event) })
  expect(code).toBe(9)
  const store = new DiagnosticStore(storePath)
  try {
    const page = store.query({ workspace: 'alice', operator: false })
    expect(page.events[0]).toMatchObject({ severity: 'error', exitCode: 9, component: 'provider-bootstrap', stderr: expect.stringContaining('precise cause'), resources: { cwdFilesystem: process.cwd() } })
    for (const value of ['private-output', 'private-argument', 'opaque-bootstrap-credential']) expect(JSON.stringify({ page, events })).not.toContain(value)
  } finally { store.close() }
})

it('preserves native warnings and deadline outcomes without inferring severity from arbitrary stderr', async () => {
  const events: LogEvent[] = []
  const options = { path: path(), workspace: 'alice', quiet: true, write: (event: LogEvent) => events.push(event) }
  expect(await captureRuntimeCommand(process.execPath, ['-e', "process.stderr.write('routine stderr')"], options)).toBe(0)
  expect(events).toHaveLength(0)
  expect(await captureRuntimeCommand(process.execPath, ['-e', "process.stderr.write('npm warn native warning')"], options)).toBe(0)
  expect(events[0].severity).toBe('warning')
  expect(await captureRuntimeCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...options, timeoutMs: 50, killAfterMs: 100 })).toBe(124)
  expect(events.at(-1)).toMatchObject({ severity: 'error', timeoutMs: 50, context: { timedOut: true } })
})

it('does not change installer status when diagnostic persistence or reporting fails', async () => {
  const storePath = path(); writeFileSync(storePath, 'broken database')
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    expect(await captureRuntimeCommand(process.execPath, ['-e', 'process.exit(7)'], { path: storePath, workspace: 'alice', quiet: true, write: () => { throw new Error('reporter offline') } })).toBe(7)
  } finally { vi.restoreAllMocks() }
})


it('records missing executable evidence and bounds oversized stdout without retaining it', async () => {
  const events: LogEvent[] = []; const options = { path: path(), workspace: 'alice', quiet: true, write: (event: LogEvent) => events.push(event) }
  expect(await captureRuntimeCommand('/missing/poise-bootstrap-executable', [], options)).toBe(127)
  expect(events[0]).toMatchObject({ exitCode: null, context: { processErrorCode: 'ENOENT', providerStarted: false } })
  expect(await captureRuntimeCommand(process.execPath, ['-e', "process.stdout.write('private-payload'.repeat(10000))"], options)).toBe(0)
  expect(events.at(-1)).toMatchObject({ source: 'collection', severity: 'warning' })
  expect(JSON.stringify(events)).not.toContain('private-payload')
})

it('persists supervisor observations through the shared private store before application startup', () => {
  const storePath = path(); const emitted: LogEvent[] = []
  vi.stubEnv('POISE_TEST_TOKEN', 'supervisor-private-credential')
  const id = recordRuntimeDiagnostic({ source: 'poise', component: 'workspace-supervisor', operation: 'workspace.spawn', level: 'error',
    release: 'old-release', message: 'spawn rejected supervisor-private-credential', errno: -13 },
    { path: storePath, workspace: 'alice', write: (event) => emitted.push(event) })
  const store = new DiagnosticStore(storePath)
  try {
    expect(store.lookup({ workspace: 'alice', operator: false }, id!)).toMatchObject({ status: 'found', event: { component: 'workspace-supervisor', release: 'old-release', errno: -13 } })
    expect(store.query({ workspace: null, operator: true }).total).toBe(0)
    expect(JSON.stringify(emitted)).not.toContain('supervisor-private-credential')
  } finally { store.close() }
})

it('retains collection loss when a successful command emits only an oversized native warning', async () => {
  const events: LogEvent[] = []
  expect(await captureRuntimeCommand(process.execPath, ['-e', "process.stderr.write('npm warn ' + 'private-payload'.repeat(10000))"],
    { path: path(), workspace: 'alice', quiet: true, write: (event) => events.push(event) })).toBe(0)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ source: 'collection', severity: 'warning', truncated: true, context: { captureError: 'Oversized bootstrap stderr line excluded' } })
  expect(JSON.stringify(events)).not.toContain('private-payload')
})


it('redacts folded bootstrap headers across child chunks before durable capture and reporting', async () => {
  const storePath = path(); const events: LogEvent[] = []
  const script = "process.stderr.write('Authorization: Bearer\\n');setTimeout(()=>{process.stderr.write(' opaque-folded-value\\n\\tsecond-folded-value\\nfatal: preserved cause');process.exit(9)},20)"
  expect(await captureRuntimeCommand(process.execPath, ['-e', script], { path: storePath, workspace: 'alice', quiet: true, write: (event) => events.push(event) })).toBe(9)
  const store = new DiagnosticStore(storePath)
  try {
    const retained = store.query({ workspace: 'alice', operator: false })
    for (const value of ['opaque-folded-value', 'second-folded-value']) expect(JSON.stringify({ retained, events })).not.toContain(value)
    expect(retained.events[0].stderr).toContain('fatal: preserved cause')
    expect(retained.events[0].exitCode).toBe(9)
  } finally { store.close() }
})


it('kills a TERM-resistant descendant after the direct installer closes its stdio and exits', async () => {
  const storePath = path(); const directory = join(storePath, '..'); const pidPath = join(directory, 'descendant.pid'); const heartbeat = join(directory, 'heartbeat')
  const child = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),10)`
  const parent = `const cp=require('node:child_process');const fs=require('node:fs');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidPath)},String(child.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`
  try {
    expect(await captureRuntimeCommand(process.execPath, ['-e', parent], { path: storePath, workspace: 'alice', timeoutMs: 800, killAfterMs: 100, quiet: true, write: () => undefined })).toBe(124)
    const stopped = readFileSync(heartbeat, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(readFileSync(heartbeat, 'utf8')).toBe(stopped)
  } finally {
    spawnSync('kill', ['-KILL', readFileSync(pidPath, 'utf8')])
  }
})
