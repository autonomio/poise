import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withProcessLock } from '../server/process-lock'
import {
  pruneReviewCheckouts, resolveReviewCheckout, reviewIdentityDirectory, reviewPrRef, REVIEW_CHECKOUT_RETENTION_MS, startReviewCheckoutPruning, stopReviewCheckoutPruning,
} from '../server/review-checkout'

const mocks = vi.hoisted(() => ({ runFile: vi.fn() }))
vi.mock('../server/process', () => ({ runFile: mocks.runFile }))
const owner = 'autonomio', repo = 'autonomio', actor = 'bit-mis', head = 'a'.repeat(40)
let root: string
const resolveCheckout = (signal?: AbortSignal) => resolveReviewCheckout(owner, repo, 146, actor, head, signal)
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'poise-review-checkout-'))
  vi.stubEnv('POISE_DB', join(root, 'cache.db'))
  vi.stubEnv('TMPDIR', root)
  mocks.runFile.mockReset().mockImplementation(async (command: string, args: string[]) => {
    if (command === 'github-interface' && args[0] === '--local-checkout-path') {
      throw Object.assign(new Error('Command failed (1): github-interface'), {
        code: 1, stderr: `error: checkout not found under /dev: ${owner}/${repo}\n`,
      })
    }
    return { stdout: '', stderr: '' }
  })
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
describe('review workspace selection', () => {
  it('uses an existing user checkout without changing it', async () => {
    mocks.runFile.mockResolvedValueOnce({ stdout: JSON.stringify({ action: 'local_checkout_path', repository: `${owner}/${repo}`, path: root }), stderr: '' })
    expect(await resolveCheckout()).toBe(root)
    expect(reviewPrRef(root, owner, repo, 146)).toBe('#146')
    expect(mocks.runFile).toHaveBeenCalledTimes(1)
  })
  it('uses the existing chain identity directory and a full PR URL on a missing checkout', async () => {
    const path = await resolveCheckout()
    expect(path).toBe(reviewIdentityDirectory(owner, repo))
    expect(reviewPrRef(path, owner, repo, 146)).toBe(`https://github.com/${owner}/${repo}/pull/146`)
    expect(mocks.runFile.mock.calls.map(([, args]) => args[0])).toEqual(['--local-checkout-path'])
    expect((await stat(path)).isDirectory()).toBe(true)
  })
  it('does not clone when the PR head moves and keeps repository identity', async () => {
    const heads = [head, 'b'.repeat(40)]
    const paths = await Promise.all(heads.map(value => resolveReviewCheckout(owner, repo, 146, actor, value)))
    expect(new Set(paths)).toEqual(new Set([reviewIdentityDirectory(owner, repo)]))
    expect(mocks.runFile.mock.calls.every(([, args]) => args[0] === '--local-checkout-path')).toBe(true)
  })
  it.each([undefined, false])('forwards process diagnostic ownership (%s)', async (reportFailure) => {
    await resolveReviewCheckout(owner, repo, 146, actor, head, undefined, reportFailure)
    expect(mocks.runFile).toHaveBeenCalledWith('github-interface', ['--local-checkout-path', owner, repo],
      expect.objectContaining({ timeoutMs: 30_000, reportFailure: reportFailure ?? true }))
  })
  it.each(['timeout', 'GitHub 404', 'malformed response'] as const)('does not fall back on %s', async (cause) => {
    if (cause === 'malformed response') mocks.runFile.mockResolvedValueOnce({ stdout: 'null', stderr: '' })
    else mocks.runFile.mockRejectedValueOnce(Object.assign(new Error(cause), { code: 1, stderr: cause }))
    await expect(resolveCheckout()).rejects.toThrow()
    expect(mocks.runFile).toHaveBeenCalledTimes(1)
  })
  it('rejects path traversal before invoking any process', async () => {
    await expect(resolveReviewCheckout(owner, '..', 146, actor, head)).rejects.toThrow('Invalid review')
    expect(mocks.runFile).not.toHaveBeenCalled()
  })
  it('does not create the identity directory after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('review cancelled'))
    await expect(resolveCheckout(controller.signal)).rejects.toThrow('review cancelled')
    await expect(stat(reviewIdentityDirectory(owner, repo))).rejects.toThrow()
  })
})
describe('review checkout retention', () => {
  const day = REVIEW_CHECKOUT_RETENTION_MS
  const checkouts = () => join(root, 'review-checkouts')
  // What review-checkouts holds besides the lock a review marks its head
  // under, and the journal SQLite keeps beside it.
  const entries = async () => (await readdir(checkouts())).filter((name) => !name.startsWith('.lock')).sort()
  // A head's checkout as provisioning leaves it, last resolved `age` ago.
  const provisioned = async (name: string, age: number): Promise<void> => {
    const headPath = join(checkouts(), name)
    await mkdir(join(headPath, owner, repo, '.git'), { recursive: true })
    await writeFile(join(headPath, owner, repo, 'README.md'), 'checkout')
    await writeFile(join(headPath, owner, `${repo}.lock`), '')
    const when = new Date(Date.now() - age)
    await utimes(headPath, when, when)
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100))

  it('removes a head a day after a review last resolved it, and keeps one resolved since', async () => {
    await provisioned('b'.repeat(40), day + 60_000)
    await provisioned('c'.repeat(40), day - 60_000)
    expect(await pruneReviewCheckouts(root)).toEqual(['b'.repeat(40)])
    expect(await entries()).toEqual(['c'.repeat(40)])
  })

  it('finishes what an interrupted prune left, and leaves what is not a head alone', async () => {
    await mkdir(join(checkouts(), `.removing-${'d'.repeat(40)}-1`, owner, repo), { recursive: true })
    await mkdir(join(checkouts(), 'notes'))
    await writeFile(join(checkouts(), 'README'), 'mine')
    expect(await pruneReviewCheckouts(root, Date.now() + 2 * day)).toEqual([])
    expect(await entries()).toEqual(['README', 'notes'])
  })

  it('has nothing to remove before any review provisioned a checkout', async () => {
    expect(await pruneReviewCheckouts(root)).toEqual([])
  })

  it('judges a head again under the lock, so it keeps one a review marked while the prune waited', async () => {
    await provisioned('b'.repeat(40), 2 * day)
    let pruning: Promise<string[]> | undefined
    await withProcessLock({ path: join(checkouts(), '.lock') }, async () => {
      pruning = pruneReviewCheckouts(root)
      await settle()
      // What a review does under this lock: mark its head used.
      const now = new Date()
      await utimes(join(checkouts(), 'b'.repeat(40)), now, now)
    })
    expect(await pruning).toEqual([])
    expect(await entries()).toEqual(['b'.repeat(40)])
  })

  it('prunes when Poise starts and every interval after, whether or not reviews run', async () => {
    await provisioned('b'.repeat(40), 2 * day)
    startReviewCheckoutPruning(50)
    try {
      await vi.waitFor(async () => expect(await entries()).toEqual([]))
      await provisioned('c'.repeat(40), 2 * day)
      await vi.waitFor(async () => expect(await entries()).toEqual([]))
    } finally {
      await stopReviewCheckoutPruning()
    }
    await provisioned('d'.repeat(40), 2 * day)
    await settle()
    expect(await entries()).toEqual(['d'.repeat(40)])
  })

  it('leaves pruning to its schedule, so a review never waits for it', async () => {
    await provisioned('b'.repeat(40), 2 * day)
    await resolveCheckout()
    await settle()
    expect(await entries()).toEqual(['b'.repeat(40)])
  })
})
