import { randomUUID } from 'node:crypto'
import { BEHAVIORS, type BehaviorKey } from '../src/behaviors'
import type { BehaviorMetrics, BehaviorMetricsReport } from '../src/behavior-metrics'
import type { LogEntry } from './agent'
import type { AnalyticsWindow } from './analytics'
import { db } from './db'

type DirectBehavior = 'resolve-unblocking' | 'merge-prs' | 'rerun-grey-ci'
interface Run {
  behavior: BehaviorKey
  startedAt: string
  completedAt: string | null
  status: string
}
const activeDirectRuns = new Set<string>()

export function startDirectBehaviorRun(behavior: DirectBehavior): string {
  const id = randomUUID()
  db.prepare('INSERT INTO behavior_runs(id, behavior, started_at) VALUES (?, ?, ?)')
    .run(id, behavior, new Date().toISOString())
  activeDirectRuns.add(id)
  return id
}

export function finishDirectBehaviorRun(id: string, success: boolean): void {
  db.prepare('UPDATE behavior_runs SET completed_at = ?, status = ? WHERE id = ?')
    .run(new Date().toISOString(), success ? 'completed' : 'failed', id)
  activeDirectRuns.delete(id)
}

const AGENT_BEHAVIORS = {
  'review-new-prs': 'pr_review', 'approve-prs': 'pr_approve', 'review-new-issues': 'issue_review',
} as const
const FAILURE = new Set(['invalid', 'failed', 'error', 'cancelled', 'canceled', 'timed_out', 'timeout'])
const SUCCESS = new Set(['completed', 'superseded'])

export function computeBehaviorMetrics(runs: Run[], window: AnalyticsWindow, now = Date.now()): BehaviorMetrics {
  const selected = runs.filter((run) => {
    const at = Date.parse(run.startedAt)
    return Number.isFinite(at) && (!window.since || at >= Date.parse(window.since))
      && (!window.until || at < Date.parse(window.until))
  })
  let durationMs = 0
  let durationKnown = true
  let finished = 0
  let failed = 0
  for (const run of selected) {
    const terminal = SUCCESS.has(run.status) || FAILURE.has(run.status)
    if (terminal) { finished++; if (FAILURE.has(run.status)) failed++ }
    const active = ['pending', 'queued', 'running', 'in_progress'].includes(run.status)
    const end = run.completedAt ? Date.parse(run.completedAt) : active ? now : NaN
    const duration = end - Date.parse(run.startedAt)
    if (!Number.isFinite(duration) || duration < 0) durationKnown = false
    else durationMs += duration
  }
  return {
    totalRuns: selected.length,
    durationMinutes: durationKnown ? durationMs / 60_000 : null,
    successRate: finished ? (finished - failed) / finished * 100 : null,
  }
}

export function readBehaviorMetrics(logs: LogEntry[], window: AnalyticsWindow, error: string | null): BehaviorMetricsReport {
  const direct = (db.prepare('SELECT id, behavior, started_at AS startedAt, completed_at AS completedAt, status FROM behavior_runs')
    .all() as (Run & { id: string })[])
    .map((run) => run.status === 'running' && !activeDirectRuns.has(run.id) ? { ...run, status: 'interrupted' } : run)
  const behaviors = Object.fromEntries(BEHAVIORS.map(({ key }) => {
    if (key in AGENT_BEHAVIORS) {
      if (error) return [key, null]
      const behavior = AGENT_BEHAVIORS[key as keyof typeof AGENT_BEHAVIORS]
      const runs = logs.filter((log) => log.behavior === behavior && log.source === `poise:${key}`)
        .map((log) => ({ behavior: key, startedAt: log.started_at_precise || log.started_at,
          completedAt: log.completed_at ?? null, status: log.status }))
      return [key, computeBehaviorMetrics(runs, window)]
    }
    return [key, computeBehaviorMetrics(direct.filter((run) => run.behavior === key), window)]
  })) as BehaviorMetricsReport['behaviors']
  return { behaviors, error }
}
