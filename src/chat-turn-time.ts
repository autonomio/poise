// When a Chat turn ended, as its meta row shows it: the time alone for a turn
// that ended today, with the date for an earlier day and the year for an
// earlier year, in the person's timezone. Kept free of imports so it can be
// tested under the node environment.

export interface TurnTime {
  /** "19:38", "20 Oct 17:05" or "31 Dec 2025 23:05". */
  text: string
  /** Everything, in words: "Wednesday 21 October 2026 at 19:38:12 EEST". */
  when: string
}

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).formatToParts(date).map((part) => [part.type, part.value]))
}

/** The calendar day `now` falls on in `timeZone`, with the zone: a turn's
 *  label can change only when this does. */
export function clockDay(timeZone: string, now: number): string {
  const day = parts(new Date(now), timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' })
  return `${timeZone} ${day.year}-${day.month}-${day.day}`
}

/** `at` is the time the server stamped on the turn's turn.finished event. A
 *  value that is not a time throws a RangeError: the protocol has none. */
export function turnTime(at: string, timeZone: string, now: number): TurnTime {
  const date = new Date(at)
  const ended = parts(date, timeZone, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
  const today = parts(new Date(now), timeZone, { day: 'numeric', month: 'short', year: 'numeric' })
  const long = parts(date, timeZone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = `${ended.hour}:${ended.minute}`
  const thisYear = ended.year === today.year
  const text = thisYear && ended.month === today.month && ended.day === today.day ? time
    : `${ended.day} ${ended.month}${thisYear ? '' : ` ${ended.year}`} ${time}`
  return { text, when: `${long.weekday} ${long.day} ${long.month} ${long.year} at ${time}:${ended.second} ${ended.timeZoneName}` }
}
