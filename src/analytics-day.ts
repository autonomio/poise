import { effectiveTimezone, midnightInZone } from './config'

/** Calendar days in Settings' timezone, including the seven completed days before selection. */
export function analyticsDay(offset: number): { label: string, since: string, until: string, baselineSince: string } {
  const start = midnightInZone(offset)
  return {
    label: offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : new Intl.DateTimeFormat('en-GB', {
      timeZone: effectiveTimezone(), day: 'numeric', month: 'short', year: 'numeric',
    }).format(start),
    since: start.toISOString(),
    until: midnightInZone(offset + 1).toISOString(),
    baselineSince: midnightInZone(offset - 7).toISOString(),
  }
}
