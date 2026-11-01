import { describe, expect, it } from 'vitest'
import { wakeStatusText, type ManagerWakeView } from '../src/chat-manager-settings-types'

function wake(nextAt: string, overrides: Partial<ManagerWakeView> = {}): ManagerWakeView {
  return { everyMinutes: 60, revision: 1, timer: { id: 'wake-1', state: 'active', nextAt },
    pendingOn: null, lastFailure: null, wakesLast24h: 0, ...overrides }
}

describe('Manager wake status on the Settings clock', () => {
  it.each([
    ['2026-10-31T12:00:00Z', '2026-10-31T13:00:00Z', 'UTC', '13:00'],
    ['2026-10-31T23:10:00Z', '2026-11-01T00:10:00Z', 'UTC', '1 Nov 00:10'],
    ['2026-12-31T23:30:00Z', '2027-01-01T00:30:00Z', 'UTC', '1 Jan 2027 00:30'],
    ['2026-10-31T21:30:00Z', '2026-10-31T22:30:00Z', 'Europe/Helsinki', '1 Nov 00:30'],
  ])('renders %s → %s in %s', (now, nextAt, zone, expected) => {
    expect(wakeStatusText(wake(nextAt), zone, Date.parse(now))).toBe(`Up to 24 turns a day · next ${expected}`)
  })

  it('dates a failure on the previous day independently of the next wake', () => {
    const view = wake('2026-11-01T00:10:00Z', { everyMinutes: 5,
      lastFailure: { at: '2026-10-31T23:55:00Z', error: 'boom' } })
    expect(wakeStatusText(view, 'UTC', Date.parse('2026-11-01T00:05:00Z')))
      .toBe('Up to 288 turns a day · last wake-up failed at 31 Oct 23:55: boom · next 00:10')
  })

  it.each([
    ['person_stopped', 'On hold: you stopped the Manager'],
    ['person_held', 'On hold: you put the Manager on hold'],
    ['all_held', 'On hold: all timers are on hold'],
  ])('keeps %s ahead of a retained failure', (reason, expected) => {
    const view = wake('2026-11-01T00:10:00Z', { timer: { id: 'wake-1', state: 'held', reason, nextAt: '2026-11-01T00:10:00Z' },
      lastFailure: { at: '2026-10-31T23:55:00Z', error: 'boom' } })
    expect(wakeStatusText(view, 'UTC', Date.parse('2026-11-01T00:05:00Z'))).toBe(expected)
  })
})
