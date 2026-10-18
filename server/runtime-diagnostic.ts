// Bootstrap runs before Poise can collect its own process errors.
import { spawn } from 'node:child_process'
import { constants as fsConstants, accessSync, realpathSync, statfsSync, writeSync } from 'node:fs'
import { constants, homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { environmentSecrets, normalize, redact, type LogEvent } from '../gateway/src/diagnostics/contract'
import { diagnosticConfig } from '../gateway/src/diagnostics/config'
import { DiagnosticStore } from '../gateway/src/diagnostics/store'

interface CaptureOptions { path?: string; workspace?: string; timeoutMs?: number; killAfterMs?: number; write?: (event: LogEvent) => void; quiet?: boolean }
function resolved(command: string): string | null {
  for (const path of isAbsolute(command) ? [command] : (process.env.PATH ?? '').split(delimiter).map((directory) => join(directory, command))) {
    try { accessSync(path, fsConstants.X_OK); return realpathSync(path) }
    catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code))) throw error }
  }
  return null
}
function publish(event: LogEvent): void {
  const line = JSON.stringify({ poiseDiagnostic: event }) + '\n'
  try { writeSync(3, line) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EBADF') throw error; process.stderr.write(line) }
}

/** Preserve installer status; neither diagnostic storage nor reporting controls installation. */
export async function captureRuntimeCommand(command: string, args: string[], options: CaptureOptions = {}): Promise<number> {
  const started = Date.now(); const at = new Date(started).toISOString()
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  const workspace = options.workspace ?? process.env.POISE_WORKSPACE_HANDLE ?? 'local'
  const secrets = environmentSecrets()
  const executable = resolved(command)
  let stderr = Buffer.alloc(0); let pending = Buffer.alloc(0); let discarding = false; let truncated = false; let nativeWarning = false
  let timedOut = false; let spawnError: NodeJS.ErrnoException | null = null; let captureError: string | null = null
  const addLine = (line: Buffer) => {
    const safe = redact(line.toString(), secrets)
    nativeWarning ||= /^(?:npm\s+warn\b|warning:|warn(?:ing)?[:\s])/im.test(safe)
    const bytes = Buffer.concat([stderr, Buffer.from(safe + '\n')])
    if (bytes.length > 16 * 1024) truncated = true
    stderr = bytes.subarray(Math.max(0, bytes.length - 16 * 1024))
  }
  const child = spawn(command, args, { detached: true, stdio: ['ignore', options.quiet ? 'ignore' : 'inherit', 'pipe'] })
  const signal = (value: NodeJS.Signals) => {
    if (!child.pid) return
    try { process.kill(-child.pid, value) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') captureError = redact(String(error), secrets) }
  }
  let killer: ReturnType<typeof setTimeout> | null = null
  const timer = setTimeout(() => { timedOut = true; signal('SIGTERM'); killer = setTimeout(() => signal('SIGKILL'), options.killAfterMs ?? 30_000); killer.unref() }, timeoutMs)
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.stderr?.on('data', (chunk: Buffer) => {
      let remaining = chunk
      while (remaining.length) {
        const end = remaining.indexOf(10); const part = end < 0 ? remaining : remaining.subarray(0, end)
        if (!discarding && pending.length + part.length > 64 * 1024) { truncated = true; discarding = true; pending = Buffer.alloc(0); addLine(Buffer.from('[oversized stderr line excluded]')) }
        if (!discarding) pending = Buffer.concat([pending, part])
        if (end < 0) return
        remaining = remaining.subarray(end + 1)
        if (!discarding) addLine(pending)
        pending = Buffer.alloc(0); discarding = false
      }
    })
    child.stderr?.on('error', (error: Error) => { captureError = redact(error.message, secrets) })
    child.once('error', (error: NodeJS.ErrnoException) => { spawnError = error })
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(timer); if (killer) clearTimeout(killer)
  if (pending.length && !discarding) addLine(pending)
  const failedSpawn = spawnError as NodeJS.ErrnoException | null
  const code = timedOut ? 124 : failedSpawn ? failedSpawn.code === 'ENOENT' ? 127 : 126 : result.code ?? 128 + (result.signal ? constants.signals[result.signal] ?? 0 : 0)
  if (!options.quiet && stderr.length) process.stderr.write(stderr.toString())
  if (code !== 0 || nativeWarning || captureError) {
    let resources: Record<string, unknown>
    try {
      const stats = statfsSync(process.cwd())
      resources = { cwdFilesystem: process.cwd(), freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize,
        freeInodes: stats.ffree, totalInodes: stats.files, measuredAt: new Date().toISOString(), affectedFilesystem: null }
    } catch (error) { resources = { measurementUnavailable: redact(String(error), secrets) } }
    const event = normalize({ id: 'bootstrap:' + at + ':' + command, time: at, source: captureError && code === 0 ? 'collection' : 'poise',
      component: 'provider-bootstrap', operation: 'provider.bootstrap', phase: 'installer_command', level: code !== 0 ? 'error' : 'warning',
      workspace, visibility: 'workspace', container: process.env.HOSTNAME ?? null, release: process.env.POISE_RELEASE || null,
      message: failedSpawn?.message ?? (timedOut ? 'Provider bootstrap command exceeded its deadline' : code !== 0 ? `Provider bootstrap command exited ${code}` : 'Provider bootstrap emitted a native warning'),
      stderr: stderr.toString(), truncated, exitCode: result.code, signal: result.signal, errno: failedSpawn?.code ?? null, timeoutMs,
      context: { configuredExecutable: command, resolvedExecutable: executable, elapsedMs: Date.now() - started, timedOut,
        stderrCaptureError: captureError, providerStarted: child.pid !== undefined }, resources }, Date.now(), secrets)!
    const path = options.path ?? join(process.env.POISE_DB ? dirname(process.env.POISE_DB) : join(homedir(), '.poise'), 'logging.db')
    let store: DiagnosticStore | null = null
    try { store = new DiagnosticStore(path, diagnosticConfig(process.env).policy); store.append([event]) }
    catch (error) {
      const gap = normalize({ source: 'collection', level: 'warning', workspace, operation: 'bootstrap.persistence_unavailable',
        message: error instanceof Error ? error.message : String(error), context: { eventId: event.id } }, Date.now(), secrets)!
      try { (options.write ?? publish)(gap) } catch { process.stderr.write('Poise bootstrap diagnostic reporting is unavailable\n') }
    } finally { store?.close() }
    try { (options.write ?? publish)(event) } catch { process.stderr.write('Poise bootstrap diagnostic reporting is unavailable\n') }
  }
  return code
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2)
  if (!command) { process.stderr.write('runtime-diagnostic requires an installer command\n'); process.exitCode = 126 }
  else process.exitCode = await captureRuntimeCommand(command, args)
}
