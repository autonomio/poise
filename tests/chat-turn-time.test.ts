// When a Chat turn ended, as its meta row shows it (src/chat-turn-time.ts),
// and where the transcript model takes that time from.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { clockDay, turnTime } from '../src/chat-turn-time'
import { applyEvent, createModel } from '../src/views/chat-transcript'

const NOW = Date.parse('2026-10-21T17:00:00Z')

describe("a turn's end time", () => {
  it("shows the time alone for a turn that ended today, in the person's time zone", () => {
    expect(turnTime('2026-10-21T16:38:12Z', 'Europe/Helsinki', NOW)).toEqual({ text: '19:38', when: 'Wednesday 21 October 2026 at 19:38:12 EEST' })
    expect(turnTime('2026-10-21T16:38:12Z', 'UTC', NOW)).toEqual({ text: '16:38', when: 'Wednesday 21 October 2026 at 16:38:12 UTC' })
  })

  it('adds the date for an earlier day and the year for an earlier year', () => {
    expect(turnTime('2026-10-20T14:05:12Z', 'Europe/Helsinki', NOW).text).toBe('20 Oct 17:05')
    expect(turnTime('2025-12-31T21:05:00Z', 'Europe/Helsinki', NOW)).toEqual({ text: '31 Dec 2025 23:05', when: 'Wednesday 31 December 2025 at 23:05:00 EET' })
  })

  it("decides today by the time zone's calendar, on a 24-hour clock", () => {
    const morning = Date.parse('2026-10-21T08:00:00Z')
    expect(turnTime('2026-10-20T21:30:00Z', 'Europe/Helsinki', morning).text).toBe('00:30')
    expect(turnTime('2026-10-20T21:30:00Z', 'UTC', morning).text).toBe('20 Oct 21:30')
  })

  it("names the zone's calendar day, which changes at the zone's midnight", () => {
    expect(clockDay('Europe/Helsinki', Date.parse('2026-10-21T20:59:59Z'))).toBe('Europe/Helsinki 2026-10-21')
    expect(clockDay('Europe/Helsinki', Date.parse('2026-10-21T21:00:00Z'))).toBe('Europe/Helsinki 2026-10-22')
    expect(clockDay('UTC', Date.parse('2026-10-21T21:00:00Z'))).toBe('UTC 2026-10-21')
  })

  it('throws for a value that is not a time', () => {
    expect(() => turnTime('not a time', 'UTC', NOW)).toThrow(RangeError)
  })
})

describe('where the end time comes from', () => {
  afterEach(() => { vi.useRealTimers() })

  it("records the turn.finished envelope's time, whatever the clock reads", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const model = createModel()
    applyEvent(model, { seq: 1, sessionId: 's', at: '2026-10-21T16:37:30.000Z', event: { type: 'turn.started', turnId: 't', prompt: { text: 'go', attachments: [], mentions: [] } } })
    applyEvent(model, { seq: 2, sessionId: 's', at: '2026-10-21T16:38:12.000Z', event: { type: 'turn.finished', turnId: 't', stopReason: 'end_turn', durationMs: 42_800 } })
    expect(model.turns.get('t')!.finished).toEqual({ stopReason: 'end_turn', durationMs: 42_800, at: '2026-10-21T16:38:12.000Z' })
  })
})
