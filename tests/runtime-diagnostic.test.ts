import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { captureRuntimeCommand } from '../server/runtime-diagnostic'
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
