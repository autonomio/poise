import { describe, expect, it } from 'vitest'
import { mocks, loadModules, arrangeCli } from './behaviors-runtime-fixture'

describe('behavior lock contention', () => {
  it('defers explicitly with its cause when another process holds the behavior lock', async () => {
    arrangeCli(false)
    mocks.spawnDetached.mockResolvedValue(undefined)
    const { database: db, behaviors: runtime } = await loadModules()
    runtime.startBehaviorsRuntime()
    db.setMeta('me', 'poise-user')
    db.setMeta('behavior_review_new_prs_keyver', '3')
    db.setMeta('behavior_review_new_prs_enabled', '1')
    db.recordSeen('review-new-prs', '__snapshot_v3__')
    mocks.lockContention = true

    await runtime.runEnabledBehaviorsOnce()

    expect(mocks.spawnDetached).not.toHaveBeenCalled()
    expect(runtime.getBehaviorsRuntimeHealth().failures).toEqual([])
    const deferral = runtime.readBehaviorDeferral('review-new-prs')
    expect(deferral?.code).toBe('BEHAVIOR_PROCESS_LOCK_BUSY')
    expect(deferral?.message).toMatch(/already running in another process/)

    mocks.lockContention = false
    await runtime.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
  })
})
