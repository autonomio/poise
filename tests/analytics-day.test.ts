import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyticsDay } from '../src/analytics-day'
import { setLocalSettings } from '../src/config'

afterEach(() => { vi.useRealTimers() })

describe('analytics calendar days', () => {
  it('labels today, yesterday, and older dates independently of browser timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T23:30:00Z'))
    setLocalSettings({ org: '', me: '', timezone: 'Asia/Kolkata' })
    expect(analyticsDay(0)).toEqual({ label: 'Today', since: '2026-01-01T18:30:00.000Z', until: '2026-01-02T18:30:00.000Z', baselineSince: '2025-12-25T18:30:00.000Z' })
    expect(analyticsDay(-1).label).toBe('Yesterday')
    expect(analyticsDay(-2).label).toBe('31 Dec 2025')
  })
  it('uses seven calendar days across daylight saving rather than 168 hours', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
    setLocalSettings({ org: '', me: '', timezone: 'Europe/Helsinki' })
    expect(analyticsDay(-1)).toEqual({ label: 'Yesterday', since: '2026-10-24T21:00:00.000Z', until: '2026-10-25T22:00:00.000Z', baselineSince: '2026-10-17T21:00:00.000Z' })
    expect(analyticsDay(0).baselineSince).toBe('2026-10-18T21:00:00.000Z')
  })
})
