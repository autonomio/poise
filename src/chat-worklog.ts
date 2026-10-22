// The Chat sessions pane as a live work log: each chat's dot state with its
// text label, and the pane's order — by latest change, with pinned chats
// holding their slots. Kept free of runtime imports beyond the clock, which
// has none, so it can be tested under the node environment.

import type { SessionStatus } from '../server/chat/protocol'
import { shortTime } from './clock'

/** The five dot states: working, finished, failed, needs the person, queued. */
export type WorklogState = 'working' | 'completed' | 'error' | 'attention' | 'queued'

export interface WorklogDot {
  state: WorklogState
  /** Visible text label, doubled as the tooltip: never colour alone. */
  label: string
}

/** A chat's dot from its session record: ongoing states read "since" their
 *  latest change, settled ones read the change's time. */
export function sessionDot(
  s: { status: SessionStatus, updatedAt: string, pendingRequests?: string[] },
  now: number,
  timeZone: string,
): WorklogDot {
  const at = Number.isNaN(Date.parse(s.updatedAt)) ? null : shortTime(s.updatedAt, timeZone, now)
  const since = (word: string): string => at ? `${word} · since ${at}` : word
  const moment = (word: string): string => at ? `${word} · ${at}` : word
  if (s.status === 'queued') return { state: 'queued', label: since('Queued') }
  if (s.status === 'waiting' || (s.pendingRequests?.length || 0) > 0) return { state: 'attention', label: since('Waiting for you') }
  if (s.status === 'error' || s.status === 'interrupted') {
    return { state: 'error', label: moment(s.status === 'interrupted' ? 'Interrupted' : 'Error') }
  }
  if (s.status === 'running' || s.status === 'stopping' || s.status === 'starting') return { state: 'working', label: since('Working') }
  return { state: 'completed', label: moment(s.status === 'closed' ? 'Closed' : 'Completed') }
}

export interface WorklogEntry {
  /** Created locally; the server has not answered yet. */
  pending: boolean
  updatedAt: string
  createdAt: string
}

/** Newest change first: a pending session is the newest thing there is, then
 *  the latest status change, with creation breaking ties. */
export function compareWorklog(a: WorklogEntry, b: WorklogEntry): number {
  if (a.pending !== b.pending) return a.pending ? -1 : 1
  return (b.updatedAt || '').localeCompare(a.updatedAt || '') || (b.createdAt || '').localeCompare(a.createdAt || '')
}

/** Re-sort an id list in place order: pinned ids hold their slots while the
 *  rest take the comparator's order. Stable, so full ties keep their slots. */
export function applyWorklogOrder(order: string[], isPinned: (id: string) => boolean, compare: (a: string, b: string) => number): string[] {
  const flowing = order.filter((id) => !isPinned(id)).sort(compare)
  let next = 0
  return order.map((id) => isPinned(id) ? id : flowing[next++]!)
}
