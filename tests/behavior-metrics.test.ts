import { beforeEach, describe, expect, it } from 'vitest'
import { computeBehaviorMetrics, finishDirectBehaviorRun, readBehaviorMetrics, startDirectBehaviorRun } from '../server/behavior-metrics'
import { db } from '../server/db'
import type { LogEntry } from '../server/agent'

const window = { since: '2026-10-17T00:00:00Z', until: '2026-10-18T00:00:00Z' }
const run = (status: string, startedAt = '2026-10-17T10:00:00Z', completedAt: string | null = '2026-10-17T10:02:00Z') =>
  ({ behavior: 'review-new-prs' as const, status, startedAt, completedAt })
const log = (extra: Partial<LogEntry> = {}): LogEntry => ({
  id: 'a'.repeat(32), repo: 'acme/api', pr_id: '1', actor: 'review-bot', model: 'model',
  behavior: 'pr_review', source: 'poise:review-new-prs', session_id: null, prompt: '',
  started_at: '2026-10-17T10:00:00Z', completed_at: '2026-10-17T10:02:00Z',
  time_elapsed: '2m', status: 'completed', outcome: 'clean', head_sha: null,
  expected_head: null, correlation_id: null, action: 'reviewed_clean', response: null, error: '', ...extra,
})

describe('behavior run metrics', () => {
  beforeEach(() => { db.prepare('DELETE FROM behavior_runs').run() })

  it('filters all metrics by inclusive start and exclusive end', () => {
    expect(computeBehaviorMetrics([
      run('completed'), run('failed'), run('completed', window.until),
      run('failed', '2026-10-16T23:59:59Z'), run('superseded', window.since, '2026-10-17T00:01:00Z'),
    ], window)).toEqual({ totalRuns: 3, durationMinutes: 5, successRate: 2 / 3 * 100 })
  })

  it('adds live elapsed time while excluding unfinished runs from the success rate', () => {
    const now = Date.parse('2026-10-17T10:03:00Z')
    expect(computeBehaviorMetrics([run('completed'), run('failed'), run('running', undefined, null)], window, now))
      .toEqual({ totalRuns: 3, durationMinutes: 7, successRate: 50 })
    expect(computeBehaviorMetrics([run('running', undefined, null)], window, now).successRate).toBeNull()
    expect(computeBehaviorMetrics([], window)).toEqual({ totalRuns: 0, durationMinutes: 0, successRate: null })
  })

  it('does not invent missing or negative terminal durations', () => {
    expect(computeBehaviorMetrics([run('failed', undefined, null)], window).durationMinutes).toBeNull()
    expect(computeBehaviorMetrics([run('completed', undefined, '2026-10-17T09:00:00Z')], window).durationMinutes).toBeNull()
  })

  it('requires the exact automatic source and behavior, excluding manual reviews and sibling behaviors', () => {
    const report = readBehaviorMetrics([log(), log({ source: 'manual' }), log({ behavior: 'issue_review' }),
      log({ source: 'poise:approve-prs' })], window, null)
    expect(report.behaviors['review-new-prs']).toEqual({ totalRuns: 1, durationMinutes: 2, successRate: 100 })
    expect(report.behaviors['approve-prs']?.totalRuns).toBe(0)
  })

  it('persists direct successes and failures independently of agent log availability', () => {
    const success = startDirectBehaviorRun('merge-prs')
    finishDirectBehaviorRun(success, true)
    const failure = startDirectBehaviorRun('merge-prs')
    finishDirectBehaviorRun(failure, false)
    const report = readBehaviorMetrics([], { since: null, until: null }, 'Logs unavailable')
    expect(report.error).toBe('Logs unavailable')
    expect(report.behaviors['review-new-prs']).toBeNull()
    expect(report.behaviors['merge-prs']).toMatchObject({ totalRuns: 2, successRate: 50 })
  })
})
