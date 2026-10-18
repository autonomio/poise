import { spawn, type ChildProcess } from 'node:child_process'
import { normalize } from './contract.js'
import { nativeDiagnostic } from './sources.js'
import { DiagnosticRuntime } from './runtime.js'

/** Host journal is read-only. No unrelated systemd service units are selected. */
export class HostJournal {
  private child: ChildProcess | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopping = false
  constructor(private readonly runtime: DiagnosticRuntime) {}
  start(): void {
    if (this.timer) return
    this.stopping = false
    this.timer = setInterval(() => { if (!this.child) this.connect() }, 15_000); this.timer.unref()
    this.connect()
  }
  private connect(): void {
    if (this.stopping) return
    let cursor: string | null
    try { cursor = this.runtime.query((db) => db.checkpoint('host-journal')) }
    catch (error) { this.runtime.observe('host-journal', 'kernel', null, String(error)); return }
    const args = ['--follow', '--no-pager', '--output=json', '--priority=warning', ...(cursor ? ['--after-cursor=' + cursor] : ['--since=-1 minute']), '_TRANSPORT=kernel', '+', '_SYSTEMD_UNIT=docker.service']
    const child = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    let pending = Buffer.alloc(0)
    let sourceError: string | null = null
    child.once('spawn', () => this.runtime.observe('host-journal', 'kernel', null))
    child.stdout?.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      if (pending.length > 128 * 1024) { sourceError = 'Host journal record exceeds its bound; observation gap'; child.kill('SIGTERM'); return }
      let end: number
      while ((end = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, end); pending = pending.subarray(end + 1)
        try {
          if (line.length > 64 * 1024) throw new Error('Host journal record exceeds 64 KiB')
          const row = JSON.parse(line.toString()) as Record<string, unknown>
          if (typeof row.__CURSOR !== 'string' || row.__CURSOR.length > 1024) throw new Error('Host journal supplied no usable cursor')
          if (row._TRANSPORT !== 'kernel' && row._SYSTEMD_UNIT !== 'docker.service') continue
          // Native operational metadata only; never unit environments or arbitrary service payloads.
          const input = nativeDiagnostic(row, row._TRANSPORT === 'kernel' ? 'kernel' : 'docker', row.__CURSOR, null)
          input.message = input.message.replace(/\/(?:home|Users)\/[^\s:'"<>]+/g, '[private path]')
          input.context = { sourceCursor: row.__CURSOR, unit: row._SYSTEMD_UNIT ?? null, transport: row._TRANSPORT ?? null }
          const event = normalize(input)
          this.runtime.query((db) => db.commitDelivery(event ? [event] : [], 'host-journal', String(row.__CURSOR)))
          this.runtime.observe('host-journal', 'kernel', null)
        } catch (error) { sourceError = String(error); this.runtime.observe('host-journal', 'kernel', null, sourceError); child.kill('SIGTERM'); return }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      sourceError = chunk.subarray(0, 2048).toString()
      this.runtime.observe('host-journal', 'kernel', null, sourceError)
    })
    child.once('error', (error) => this.runtime.observe('host-journal', 'kernel', null, error.message))
    child.once('close', (code, signal) => {
      if (this.child === child) this.child = null
      if (!this.stopping) this.runtime.observe('host-journal', 'kernel', null, sourceError ?? `Host journal stopped (exit ${code}, signal ${signal}); observation unavailable`)
    })
  }
  stop(): void { this.stopping = true; if (this.timer) clearInterval(this.timer); this.timer = null; this.child?.kill('SIGTERM'); this.child = null }
}
