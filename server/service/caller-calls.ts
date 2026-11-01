// `runningCallerCalls` in /api/service/health: the Caller calls running in
// this workspace that a restart of the container would cut. Detached launches
// (behavior runs, manual reviews and replays, card chats, /content) are
// counted from spawn to exit where this server spawns them; the /consensus
// debate runs inside its request and is counted around it here. A release
// switch restarts only the server, so calls an earlier server started keep
// running unseen by this count: Caller's own records, with each process still
// alive, count those. Chat turns are `activeChatTurns`.

import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { BEHAVIOR_CALL_SOURCES, runningCallerLaunches } from '../process'
import { callerDatabase } from '../caller-store'

let debates = 0

export async function countDebate<T>(run: () => Promise<T>): Promise<T> {
  debates += 1
  try {
    return await run()
  } finally {
    debates -= 1
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** How long one service-health read waits on Caller's records: an uncontended
 *  open-select-close costs under 2 ms at 13 rows, so 100 ms keeps generous
 *  headroom while bounding a contended health handler to a tenth of its
 *  former worst case. Unknown stays safe: health reports idle false. */
export const CALLER_CALLS_READ_TIMEOUT_MS = 100

/** Caller calls recorded as running whose process is alive, whichever server
 *  started them; null when the records exist but cannot be read. */
function callerActivity(dataDir: string | undefined, behaviorOnly: boolean, resources: boolean): { live: number, pendingResources: number | null } | null {
  try { return callerDatabase(dataDir, path => readCallerActivity(path, behaviorOnly, resources)) }
  catch { return null }
}

function readCallerActivity(path: string, behaviorOnly: boolean, resources: boolean): { live: number, pendingResources: number | null } | null {
  if (!path || !existsSync(path)) return { live: 0, pendingResources: 0 }
  let db: InstanceType<typeof Database> | undefined
  try {
    db = new Database(path, { readonly: true, fileMustExist: true, timeout: CALLER_CALLS_READ_TIMEOUT_MS })
    db.exec('BEGIN')
    // A turn Poise runs itself is recorded with an external runner and no process.
    const rows = db.prepare("select pid from calls where status = 'running' and pid is not null and runner is null"
      + (behaviorOnly ? ` and (source is null or source in (${BEHAVIOR_CALL_SOURCES.map(() => '?').join(',')}))` : ''))
      .all(...(behaviorOnly ? BEHAVIOR_CALL_SOURCES : [])) as Array<{ pid: unknown }>
    let pendingResources: number | null = 0
    if (resources) {
      try {
        const pending = db.prepare("select count(*) as count from calls where source='poise:behavior-chain' and (resources_settled_at is null or resource_cleanup is not null)").get() as { count: number }
        pendingResources = pending.count
      } catch { pendingResources = null }
    }
    return { live: rows.filter(({ pid }) => Number.isSafeInteger(Number(pid)) && Number(pid) > 0 && alive(Number(pid))).length,
      pendingResources }
  } catch {
    // Unknown, not none: calls an earlier server started may be running unseen.
    return null
  } finally {
    db?.close()
  }
}

export function liveCallerCalls(dataDir = process.env.AGENT_INTERFACE_DATA_DIR, behaviorOnly = false): number | null {
  return callerActivity(dataDir, behaviorOnly, false)?.live ?? null
}

/** The Caller calls a restart would cut. `known` is false while Caller's
 *  records cannot be read; `count` then holds this server's own launches. */
export function runningCallerCalls(behaviorOnly = false): { count: number, pendingResources: number, known: boolean } {
  const activity = callerActivity(process.env.AGENT_INTERFACE_DATA_DIR, behaviorOnly, true)
  return { count: Math.max(runningCallerLaunches(behaviorOnly) + (behaviorOnly ? 0 : debates), activity?.live ?? 0),
    pendingResources: activity?.pendingResources ?? 0, known: activity !== null && activity.pendingResources !== null }
}
