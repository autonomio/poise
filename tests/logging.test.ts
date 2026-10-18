import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnostic, diagnosticFailure, diagnosticPage, loggingRuntime, startLogging, stopLogging } from '../server/logging'
import { runFile } from '../server/process'

let directory = ''
afterEach(async () => { await stopLogging(); vi.restoreAllMocks(); vi.unstubAllEnvs(); if (directory) rmSync(directory, { recursive: true, force: true }) })
function start() {
  directory = mkdtempSync(join(tmpdir(), 'poise-logging-source-'))
  vi.stubEnv('POISE_DB', join(directory, 'cache.db'))
  vi.stubEnv('POISE_WORKSPACE_HANDLE', 'alice')
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  startLogging()
}

describe('independent application capture', () => {
  it('retains exact process evidence without prompts, response artifacts or credentials', async () => {
    start()
    diagnosticFailure('provider.failed', Object.assign(new Error('provider rejection'), { stderr: 'fatal: exact cause\nAuthorization: Bearer opaque-secret', code: 7 }),
      { prompt: 'private-prompt', responses: ['private-response'], phase: 'launch' })
    loggingRuntime()!.flush()
    const page = diagnosticPage(null)
    const event = page.events.find((record) => record.operation === 'provider.failed')!
    expect(event).toMatchObject({ exitCode: 7, stderr: expect.stringContaining('fatal: exact cause'), context: { phase: 'launch' } })
    for (const secret of ['opaque-secret', 'private-prompt', 'private-response']) expect(JSON.stringify(page)).not.toContain(secret)
    expect(diagnosticPage(page.cursor).events.some((record) => record.id === event.id)).toBe(false)
    await stopLogging(); startLogging(); loggingRuntime()!.flush()
    expect(diagnosticPage(null).events.some((record) => record.id === event.id)).toBe(true)
  })

  it('captures actual command outcomes and excludes argv/stdout', async () => {
    start()
    await expect(runFile(process.execPath, ['-e', "process.stdout.write('private-output');process.stderr.write('precise stderr');process.exit(9)", 'private-argument'])).rejects.toThrow('Command failed')
    loggingRuntime()!.flush()
    const page = loggingRuntime()!.query((db) => db.query({ workspace: 'alice', operator: false }))
    expect(page.events.some((event) => event.exitCode === 9 && event.stderr === 'precise stderr')).toBe(true)
    for (const value of ['private-output', 'private-argument']) expect(JSON.stringify(page)).not.toContain(value)
  })

  it('reports a failed sink independently and leaves source work operational', () => {
    start()
    expect(() => diagnostic({ source: 'poise', level: 'error', operation: 'read', message: 'cause' })).not.toThrow()
    loggingRuntime()!.flush()
    expect(readFileSync(join(directory, 'logging.db.coverage.json'), 'utf8')).toContain('application')
    expect(loggingRuntime()!.health().queuedBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
  })
})
