import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnostic, diagnosticFailure, diagnosticPage, fatalDiagnostic, loggingRuntime, startLogging, stopLogging } from '../server/logging'
import { runFile } from '../server/process'

let directory = ''
afterEach(async () => { await stopLogging(); vi.restoreAllMocks(); vi.unstubAllEnvs(); if (directory) rmSync(directory, { recursive: true, force: true }) })
function start(blocked = false) {
  directory = mkdtempSync(join(tmpdir(), 'poise-logging-source-'))
  if (blocked) writeFileSync(join(directory, 'logging.db'), 'not a database')
  vi.stubEnv('POISE_DB', join(directory, 'cache.db'))
  vi.stubEnv('POISE_WORKSPACE_HANDLE', 'alice')
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  startLogging()
}

describe('independent application capture', () => {
  it('retains exact process evidence without prompts, response artifacts or credentials', async () => {
    start()
    diagnosticFailure('provider.failed', Object.assign(new Error('provider rejection'), { stderr: 'fatal: exact cause\nAuthorization: Bearer opaque-secret', code: 7 }),
      { prompt: 'private-prompt', responses: ['private-response'], phase: 'launch', account: 'octocat' })
    loggingRuntime()!.flush()
    const page = diagnosticPage(null)
    const event = page.events.find((record) => record.operation === 'provider.failed')!
    expect(event).toMatchObject({ account: 'octocat', phase: 'launch', exitCode: 7, stderr: expect.stringContaining('fatal: exact cause'), context: { phase: 'launch' } })
    for (const secret of ['opaque-secret', 'private-prompt', 'private-response']) expect(JSON.stringify(page)).not.toContain(secret)
    expect(loggingRuntime()!.query((db) => db.query({ workspace: 'alice', operator: false }, { account: 'octocat' })).total).toBe(1)
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

  it('reports a failed sink independently and leaves source work operational', async () => {
    start(true)
    expect(() => diagnostic({ source: 'poise', level: 'error', operation: 'read', message: 'cause' })).not.toThrow()
    loggingRuntime()!.flush()
    expect(loggingRuntime()!.health().status).toBe('unavailable')
    await expect(runFile(process.execPath, ['-e', 'process.exit(0)'])).resolves.toMatchObject({ stdout: '' })
    expect(readFileSync(join(directory, 'logging.db.coverage.json'), 'utf8')).toContain('application')
    expect(loggingRuntime()!.health().queuedBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
  })
})


it('preserves a Critical crash record behind more than one queued batch', () => {
  start()
  for (let i = 0; i < 150; i++) diagnostic({ id: 'pending-' + i, source: 'poise', operation: 'pending.error', level: 'error', message: 'pending cause' })
  fatalDiagnostic(new Error('exact fatal cause'))
  const page = loggingRuntime()!.query((db) => db.query({ workspace: 'alice', operator: false }, { severities: ['critical'] }))
  expect(page.total).toBe(1); expect(page.events[0].message).toBe('exact fatal cause')
})

it('keeps application startup operational when its Caller checkpoint cannot be read', () => {
  directory = mkdtempSync(join(tmpdir(), 'poise-logging-checkpoint-'))
  mkdirSync(join(directory, 'logging.db.caller'))
  vi.stubEnv('POISE_DB', join(directory, 'cache.db'))
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  expect(() => startLogging()).not.toThrow()
  expect(loggingRuntime()!.health().sources.some((source) => source.source === 'caller' && source.error)).toBe(true)
})
