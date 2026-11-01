import { closeSync, constants, fstatSync, openSync } from 'node:fs'
import { join } from 'node:path'

/** Private supervisor handles keep health/maintenance on the original Caller
 * records after an ancestor rename. No path absence certifies an idle lane. */
export function callerDatabase<T>(dataDir: string | undefined, read: (path: string) => T): T {
  const path = dataDir ? join(dataDir, 'calls.sqlite3') : ''
  const raw: unknown = process.env.POISE_NATIVE_CONTROL ? JSON.parse(process.env.POISE_NATIVE_CONTROL) : null
  if (!raw || typeof raw !== 'object' || !('store' in raw)) return read(path)
  const store = raw.store
  if (!store || typeof store !== 'object' || !('path' in store) || store.path !== dataDir
    || !('pid' in store) || !Number.isSafeInteger(store.pid) || Number(store.pid) < 1
    || !('directoryFd' in store) || !Number.isSafeInteger(store.directoryFd) || Number(store.directoryFd) < 0
    || !('directory' in store) || !('database' in store)) throw new Error('Caller metadata controller reference is invalid')
  const identity = (fd: number, expected: unknown, directory: boolean) => {
    const node = fstatSync(fd, { bigint: true })
    if (!expected || typeof expected !== 'object' || !('device' in expected) || !('inode' in expected)
      || String(node.dev) !== expected.device || String(node.ino) !== expected.inode
      || (directory ? !node.isDirectory() : !node.isFile()) || node.uid !== BigInt(process.getuid!())) {
      throw new Error('Caller metadata differs from its original workspace directory')
    }
  }
  const fd = openSync(`/proc/${store.pid}/fd/${store.directoryFd}`, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    identity(fd, store.directory, true)
    const anchored = `/proc/self/fd/${fd}/calls.sqlite3`
    const database = openSync(anchored, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { identity(database, store.database, false) }
    finally { closeSync(database) }
    return read(anchored)
  } finally { closeSync(fd) }
}
