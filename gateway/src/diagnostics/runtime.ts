import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { environmentSecrets, normalize, redact, type DiagnosticInput, type LogEvent } from './contract.js'
import { DEFAULT_LOG_POLICY, DiagnosticConflictError, DiagnosticStore, type Coverage, type LogPolicy } from './store.js'

interface Journal { writtenAt: string; stopped: boolean; dropped: number; sources: Coverage[] }
export interface RuntimeOptions {
  path: string
  policy?: LogPolicy
  maxQueueBytes?: number
  maxQueueEvents?: number
  now?: () => number
  secrets?: readonly string[]
  report?: (line: string) => void
}

/** A broken diagnostic sink cannot throw into an agent, request or gateway. */
export class DiagnosticRuntime {
  private store: DiagnosticStore | null = null
  private queue: Array<{ event: LogEvent; bytes: number }> = []
  private queuedBytes = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private scheduled = false
  private retryAt = 0
  private lastError: string | null = null
  private lastSuccess: string | null = null
  private journalAt = 0
  private dropped = 0
  private droppedSince: string | null = null
  private stopped = false
  private readonly sources = new Map<string, Coverage>()
  private readonly now: () => number
  private readonly secrets: readonly string[]
  private readonly report: (line: string) => void
  private readonly policy: LogPolicy

  constructor(private readonly options: RuntimeOptions) {
    this.now = options.now ?? Date.now
    this.secrets = options.secrets ?? environmentSecrets()
    this.policy = options.policy ?? DEFAULT_LOG_POLICY
    this.report = options.report ?? ((line) => process.stderr.write(line + '\n'))
    const path = this.journalPath()
    if (path && existsSync(path)) {
      try {
        const journal = JSON.parse(readFileSync(path, 'utf8')) as Journal
        if (!journal || !Array.isArray(journal.sources) || journal.sources.length > 256
          || !Number.isFinite(Date.parse(journal.writtenAt)) || !Number.isSafeInteger(journal.dropped)) throw new Error('Invalid collection coverage journal')
        this.dropped = journal.dropped
        for (const source of journal.sources) {
          if (!source.id || !source.source || !Array.isArray(source.gaps)) throw new Error('Invalid collection source in coverage journal')
          const value = { ...source, status: 'partial' as const, gaps: source.gaps.slice(-31) }
          if (!journal.stopped) value.gaps.push({ from: journal.writtenAt, to: this.iso(), reason: 'Collector observation unavailable during restart; completeness is unknown' })
          this.sources.set(value.id, value)
        }
      } catch (error) { this.fail(error) }
    }
  }

  private iso(): string { return new Date(this.now()).toISOString() }
  private journalPath(): string | null { return this.options.path === ':memory:' ? null : this.options.path + '.coverage.json' }

  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => this.flush(), 1000)
    this.timer.unref()
    this.schedule()
  }

  emit(input: DiagnosticInput): string | null {
    if (this.stopped) return null
    try {
      const event = normalize({ ...input, time: input.time === undefined ? this.iso() : input.time }, this.now(), this.secrets)
      if (!event) return null
      const bytes = Buffer.byteLength(JSON.stringify(event))
      if (this.queue.length >= (this.options.maxQueueEvents ?? 1000)
        || this.queuedBytes + bytes > (this.options.maxQueueBytes ?? 2 * 1024 * 1024)) {
        this.dropped++
        this.droppedSince ??= this.iso()
        this.saveJournal()
        return null
      }
      this.queue.push({ event, bytes }); this.queuedBytes += bytes
      this.schedule()
      return event.id
    } catch (error) { this.fail(error); return null }
  }

  observe(id: string, source: string, workspace: string | null, error: string | null = null): void {
    if (!this.sources.has(id) && this.sources.size >= 256) { this.fail(new Error('Collection source limit of 256 reached')); return }
    const previous = this.sources.get(id)
    const at = this.iso()
    const reason = error === null ? null : redact(error, this.secrets).slice(0, 2048)
    const gaps = [...(previous?.gaps ?? [])]
    if (reason && gaps.at(-1)?.to !== null) gaps.push({ from: at, to: null, reason })
    if (!reason && gaps.at(-1)?.to === null) gaps[gaps.length - 1] = { ...gaps[gaps.length - 1], to: at }
    this.sources.set(id, { id, source, workspace, status: reason ? 'unavailable' : gaps.length ? 'partial' : 'connected',
      observedAt: reason ? previous?.observedAt ?? null : at, ingestedAt: previous?.ingestedAt ?? null,
      availableFrom: previous?.availableFrom ?? (reason ? null : at), error: reason, gaps: gaps.slice(-32) })
    if (reason && previous?.error !== reason) this.emit({ source: 'collection', component: source, level: 'warning', operation: 'source.unavailable',
      id: `coverage:${id}:${at}`, workspace, message: reason, context: { source, coverageId: id } })
    this.saveJournal()
  }

  health() {
    return { status: this.lastError ? 'unavailable' : this.lastSuccess === null ? 'initializing' : this.dropped ? 'partial' : 'connected',
      error: this.lastError, checkedAt: this.iso(), lastIngestionAt: this.lastSuccess,
      queued: this.queue.length, queuedBytes: this.queuedBytes, dropped: this.dropped,
      droppedSince: this.droppedSince, sources: [...this.sources.values()], policy: this.policy }
  }

  query<T>(read: (store: DiagnosticStore) => T): T {
    try {
      this.store ??= new DiagnosticStore(this.options.path, this.policy, this.now)
      return read(this.store)
    } catch (error) { this.fail(error); throw new Error(this.lastError ?? 'Logging is unavailable') }
  }

  flush(): void {
    if (this.now() < this.retryAt) return
    try {
      this.store ??= new DiagnosticStore(this.options.path, this.policy, this.now)
      const batch = this.queue.slice(0, 100)
      this.store.append(batch.map(({ event }) => event))
      this.store.prune()
      for (const source of this.sources.values()) {
        if (batch.some(({ event }) => event.source === source.source && event.workspace === source.workspace)) source.ingestedAt = this.iso()
        this.store.coverage(source)
      }
      for (const { bytes } of batch) this.queuedBytes -= bytes
      this.queue.splice(0, batch.length)
      const recovered = this.lastError
      this.lastError = null
      this.lastSuccess = this.iso()
      this.retryAt = 0
      if (recovered) this.emit({ source: 'collection', level: 'warning', operation: 'sink.recovered', message: 'Diagnostic collection recovered after an unavailable interval',
        context: { previousError: recovered, dropped: this.dropped, unavailableSince: this.droppedSince } })
      this.saveJournal()
      if (this.queue.length) this.schedule()
    } catch (error) {
      if (error instanceof DiagnosticConflictError) {
        const rejected = this.queue.filter(({ event }) => event.id === error.eventId)
        this.queue = this.queue.filter(({ event }) => event.id !== error.eventId)
        for (const entry of rejected) this.queuedBytes -= entry.bytes
        this.emit({ source: 'collection', level: 'warning', operation: 'identity.conflict', message: error.message,
          workspace: rejected[0]?.event.workspace, context: { eventId: error.eventId } })
        this.schedule()
      } else { this.fail(error); this.retryAt = this.now() + 5000 }
    }
  }

  private fail(error: unknown): void {
    const message = redact(error instanceof Error ? error.message : String(error), this.secrets).slice(0, 2048)
    if (message !== this.lastError) this.report(JSON.stringify({ level: 'error', event: 'logging.unavailable', message }))
    this.lastError = message
  }

  private schedule(): void {
    if (this.scheduled || this.stopped) return
    this.scheduled = true
    setImmediate(() => { this.scheduled = false; if (!this.stopped) this.flush() })
  }

  private saveJournal(force = false): void {
    const path = this.journalPath()
    if (!path || (!force && this.now() - this.journalAt < 1000)) return
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const journal: Journal = { writtenAt: this.iso(), stopped: this.stopped, dropped: this.dropped, sources: [...this.sources.values()] }
      writeFileSync(path + '.tmp', JSON.stringify(journal), { mode: 0o600 })
      renameSync(path + '.tmp', path)
      this.journalAt = this.now()
    } catch (error) { this.fail(error) }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.flush()
    this.stopped = true
    // Pending bounded records are explicitly lost if shutdown cannot drain.
    if (this.queue.length) { this.dropped += this.queue.length; this.droppedSince ??= this.iso() }
    this.saveJournal(true)
    this.store?.close(); this.store = null
  }
}
