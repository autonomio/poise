import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { arrangeCli, fixture, HEAD_SHA, loadModules, mocks, pr } from './behaviors-runtime-fixture'

it.each(['review', 'approval'] as const)('launches %s through Caller without a full clone', async (behavior) => {
  vi.stubEnv('TMPDIR', fixture.tempRoot)
  arrangeCli(behavior === 'approval')
  mocks.spawnDetached.mockResolvedValue(undefined)
  const { database, behaviors } = await loadModules()
  database.setMeta('me', 'poise-user')
  if (behavior === 'review') {
    database.setMeta('behavior_review_new_prs_keyver', '3')
    database.setMeta('behavior_review_new_prs_enabled', '1')
    database.recordSeen('review-new-prs', '__snapshot_v3__')
  } else database.setMeta('behavior_approve_prs_enabled', '1')
  behaviors.startBehaviorsRuntime()
  const original = mocks.runFile.getMockImplementation()!
  mocks.runFile.mockImplementation((command: string, args: string[], options: unknown) => {
    if (command === 'github-interface' && args[0] === '--local-checkout-path') {
      return Promise.reject(Object.assign(new Error('missing checkout'), {
        code: 1, stderr: `error: checkout not found under /fake: ${pr.repo}\n`,
      }))
    }
    return original(command, args, options)
  })
  try {
    await behaviors.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    const args = mocks.spawnDetached.mock.calls[0][1] as string[]
    expect(args).toContain(`https://github.com/${pr.repo}/pull/${pr.number}`)
    expect(args).toEqual(expect.arrayContaining(['--actor', 'review-bot', '--expected-head', HEAD_SHA,
      '--pwd', join(fixture.tempRoot, 'poise-gh-interface', 'Vaquum', 'poise-test')]))
    expect(mocks.runFile.mock.calls.some(([, argv]) => argv[0] === '--checkout-repo')).toBe(false)
  } finally { vi.unstubAllEnvs() }
})

it('continues reviewing unrelated PRs while a prior Caller review is running', async () => {
  vi.stubEnv('TMPDIR', fixture.tempRoot)
  arrangeCli(false)
  mocks.spawnDetached.mockResolvedValue(undefined)
  const { database, behaviors } = await loadModules()
  database.setMeta('me', 'poise-user')
  database.setMeta('behavior_review_new_prs_keyver', '3')
  database.setMeta('behavior_review_new_prs_enabled', '1')
  database.recordSeen('review-new-prs', '__snapshot_v3__')
  behaviors.startBehaviorsRuntime()
  const original = mocks.runFile.getMockImplementation()!
  mocks.runFile.mockImplementation((command: string, args: string[], options: unknown) => {
    if (command === 'github-interface' && args[0] === '--local-checkout-path') {
      return Promise.reject(Object.assign(new Error('missing checkout'), {
        code: 1, stderr: `error: checkout not found under /fake: ${args[1]}/${args[2]}\n`,
      }))
    }
    return original(command, args, options)
  })
  try {
    await behaviors.runEnabledBehaviorsOnce()
    expect(mocks.spawnDetached).toHaveBeenCalledOnce()
    fixture.listedPrs = [pr, { ...pr, repo: 'Vaquum/other-test', number: 18,
      url: 'https://github.com/Vaquum/other-test/pull/18' }]
    await behaviors.runEnabledBehaviorsOnce({ skipBusy: true })
    expect(mocks.spawnDetached).toHaveBeenCalledTimes(2)
    expect(mocks.spawnDetached.mock.calls[1][1]).toContain('https://github.com/Vaquum/other-test/pull/18')
  } finally { vi.unstubAllEnvs() }
})
