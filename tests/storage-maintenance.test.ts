import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OWNER = 'Poise local Chat workspace v1\n'
const DAY = 24 * 60 * 60_000

let root = ''
let chatRoot = ''
let stateRoot = ''
let home = ''
let maintenance: typeof import('../server/storage-maintenance')
let database: typeof import('../server/db') | null = null

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

async function makeWorkspace(id: string, options: { marker?: boolean } = {}): Promise<string> {
  const dir = join(chatRoot, 'workers', id, 'workspace')
  await mkdir(dir, { recursive: true })
  git(dir, 'init', '--quiet', '-b', 'main')
  git(dir, 'config', 'user.name', 'Poise test')
  git(dir, 'config', 'user.email', 'poise-test@example.invalid')
  git(dir, 'config', 'commit.gpgSign', 'false')
  await mkdir(join(dir, '.git', 'info'), { recursive: true })
  await writeFile(join(dir, '.git', 'info', 'exclude'), '.poise-workspace-owner\n')
  await writeFile(join(dir, 'note.txt'), 'hello\n')
  git(dir, 'add', 'note.txt')
  git(dir, 'commit', '--quiet', '--no-gpg-sign', '-m', 'first')
  if (options.marker !== false) await writeFile(join(dir, '.poise-workspace-owner'), OWNER)
  return dir
}

async function age(path: string, ms: number): Promise<void> {
  const at = new Date(Date.now() - ms)
  await utimes(path, at, at)
}

function claimsFor(status: string, updatedAt: string, extra: Partial<{ openTurn: boolean, queued: boolean }> = {}) {
  return () => [{ sessionId: 'session-1', status, updatedAt, openTurn: false, queued: false, ...extra }]
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'poise-storage-maintenance-'))
  chatRoot = join(root, 'chat')
  stateRoot = join(root, 'state')
  home = join(root, 'home')
  await mkdir(home, { recursive: true })
  vi.stubEnv('POISE_DB', join(root, 'cache.db'))
  vi.stubEnv('PIP_CACHE_DIR', join(home, 'pip'))
  vi.stubEnv('UV_CACHE_DIR', join(home, 'uv'))
  vi.stubEnv('npm_config_cache', join(home, 'npm'))
  vi.stubEnv('AGENT_INTERFACE_WORK_DIR', join(home, 'agent-work'))
  vi.stubEnv('GITHUB_INTERFACE_MIRROR_DIR', join(home, 'mirrors'))
  vi.resetModules()
  maintenance = await import('../server/storage-maintenance')
  database = await import('../server/db')
})

afterEach(async () => {
  if (database?.db.open) database.closeDatabase()
  database = null
  vi.unstubAllEnvs()
  vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

describe('chat worker workspace retention', () => {
  it('removes a closed, pushed workspace after the grace period', async () => {
    const id = '11111111-1111-1111-1111-111111111111'
    const checkout = await makeWorkspace(id)
    const remote = join(root, 'remote.git')
    git(root, 'init', '--quiet', '--bare', remote)
    git(checkout, 'remote', 'add', 'origin', remote)
    git(checkout, 'push', '--quiet', '-u', 'origin', 'main')
    await age(checkout, 2 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: claimsFor('closed', new Date(Date.now() - 2 * DAY).toISOString()),
    })
    expect(report.removed.map((item) => item.path)).toContain(checkout)
    expect(report.reclaimedBytes).toBeGreaterThan(0)
    await expect(lstat(join(chatRoot, 'workers', id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('holds a closed workspace with uncommitted changes, with the reason', async () => {
    const id = '22222222-2222-2222-2222-222222222222'
    const checkout = await makeWorkspace(id)
    await writeFile(join(checkout, 'draft.txt'), 'unsaved\n')
    await age(checkout, 2 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: claimsFor('closed', new Date(Date.now() - 2 * DAY).toISOString()),
    })
    expect(report.removed).toHaveLength(0)
    expect(report.held).toHaveLength(1)
    expect(report.held[0].path).toBe(checkout)
    expect(report.held[0].reason).toMatch(/uncommitted/)
    await expect(readFile(join(checkout, 'draft.txt'), 'utf8')).resolves.toBe('unsaved\n')
  })

  it('holds a closed workspace with unpushed commits', async () => {
    const id = '33333333-3333-3333-3333-333333333333'
    const checkout = await makeWorkspace(id)
    const remote = join(root, 'remote.git')
    git(root, 'init', '--quiet', '--bare', remote)
    git(checkout, 'remote', 'add', 'origin', remote)
    git(checkout, 'push', '--quiet', '-u', 'origin', 'main')
    await writeFile(join(checkout, 'more.txt'), 'local only\n')
    git(checkout, 'add', 'more.txt')
    git(checkout, 'commit', '--quiet', '--no-gpg-sign', '-m', 'local only')
    await age(checkout, 2 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: claimsFor('closed', new Date(Date.now() - 2 * DAY).toISOString()),
    })
    expect(report.removed).toHaveLength(0)
    expect(report.held).toHaveLength(1)
    expect(report.held[0].reason).toMatch(/unpushed/)
  })

  it('removes a closed workspace whose branch merged', async () => {
    const id = '44444444-4444-4444-4444-444444444444'
    const checkout = await makeWorkspace(id)
    const remote = join(root, 'remote.git')
    git(root, 'init', '--quiet', '--bare', remote)
    git(checkout, 'remote', 'add', 'origin', remote)
    git(checkout, 'push', '--quiet', '-u', 'origin', 'main')
    git(checkout, 'checkout', '--quiet', '-b', 'feature')
    await writeFile(join(checkout, 'feature.txt'), 'done\n')
    git(checkout, 'add', 'feature.txt')
    git(checkout, 'commit', '--quiet', '--no-gpg-sign', '-m', 'feature')
    git(checkout, 'checkout', '--quiet', 'main')
    git(checkout, 'merge', '--quiet', '--no-ff', 'feature', '-m', 'merge feature')
    git(checkout, 'push', '--quiet', 'origin', 'main')
    // The merged branch has no upstream of its own, as after a squash-merge.
    await age(checkout, 2 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: claimsFor('closed', new Date(Date.now() - 2 * DAY).toISOString()),
    })
    expect(report.removed.map((item) => item.path)).toContain(checkout)
  })

  it('holds a closed workspace inside the grace period', async () => {
    const id = '55555555-5555-5555-5555-555555555555'
    const checkout = await makeWorkspace(id)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: claimsFor('closed', new Date(Date.now() - 60_000).toISOString()),
    })
    expect(report.removed).toHaveLength(0)
    expect(report.held[0].reason).toMatch(/grace/)
    await expect(lstat(checkout)).resolves.toBeDefined()
  })

  it('prunes only regenerable artifacts from an open idle session', async () => {
    const id = '66666666-6666-6666-6666-666666666666'
    const checkout = await makeWorkspace(id)
    await mkdir(join(checkout, 'node_modules', 'left-pad'), { recursive: true })
    await writeFile(join(checkout, 'node_modules', 'left-pad', 'index.js'), 'module.exports={}\n')
    await mkdir(join(checkout, 'dist'), { recursive: true })
    await writeFile(join(checkout, 'dist', 'app.js'), 'bundle\n')
    await mkdir(join(checkout, 'src'), { recursive: true })
    await writeFile(join(checkout, 'src', 'keep.ts'), 'export {}\n')
    await age(checkout, 4 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: claimsFor('idle', new Date(Date.now() - 4 * DAY).toISOString()),
    })
    expect(report.removed).toHaveLength(0)
    expect(report.pruned.map((item) => item.path).sort()).toEqual(
      [join(checkout, 'dist'), join(checkout, 'node_modules')].sort())
    await expect(lstat(join(checkout, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(checkout, 'dist'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(checkout, 'src', 'keep.ts'), 'utf8')).resolves.toBe('export {}\n')
    await expect(lstat(join(checkout, '.git'))).resolves.toBeDefined()
    const marker = JSON.parse(await readFile(join(chatRoot, 'workers', id, '.poise-maintenance.json'), 'utf8')) as { pruned: string[] }
    expect(marker.pruned.sort()).toEqual(['dist', 'node_modules'])
  })

  it.each([
    { name: 'a running turn', extra: { openTurn: true } },
    { name: 'a queued turn', extra: { queued: true } },
  ])('leaves a session with $name untouched', async ({ extra }) => {
    const id = '77777777-7777-7777-7777-777777777777'
    const checkout = await makeWorkspace(id)
    await mkdir(join(checkout, 'node_modules'), { recursive: true })
    await writeFile(join(checkout, 'node_modules', 'blob.js'), 'x\n')
    await age(checkout, 4 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: claimsFor('idle', new Date(Date.now() - 4 * DAY).toISOString(), extra),
    })
    expect(report.removed).toHaveLength(0)
    expect(report.pruned).toHaveLength(0)
    expect(report.held[0].reason).toMatch(/running or queued/)
    await expect(lstat(join(checkout, 'node_modules', 'blob.js'))).resolves.toBeDefined()
    await expect(lstat(join(chatRoot, 'workers', id, '.poise-maintenance.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes a deleted session workspace past the grace period', async () => {
    const id = '88888888-8888-8888-8888-888888888888'
    const checkout = await makeWorkspace(id)
    await age(checkout, 2 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null, claims: () => [],
    })
    expect(report.removed.map((item) => item.path)).toContain(checkout)
  })

  it('holds a workspace with an invalid owner marker', async () => {
    const id = '99999999-9999-9999-9999-999999999999'
    const checkout = await makeWorkspace(id, { marker: false })
    await age(checkout, 2 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null, claims: () => [],
    })
    expect(report.removed).toHaveLength(0)
    expect(report.held[0].reason).toMatch(/marker/)
  })

  it('reports unpushed branches: ahead, merged, and remote-less', async () => {
    const dir = await makeWorkspace('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    // No remote: committed scratch has nothing unpushed.
    expect(await maintenance.unpushedBranches(dir)).toEqual([])
    const remote = join(root, 'remote.git')
    git(root, 'init', '--quiet', '--bare', remote)
    git(dir, 'remote', 'add', 'origin', remote)
    git(dir, 'push', '--quiet', '-u', 'origin', 'main')
    expect(await maintenance.unpushedBranches(dir)).toEqual([])
    await writeFile(join(dir, 'ahead.txt'), 'ahead\n')
    git(dir, 'add', 'ahead.txt')
    git(dir, 'commit', '--quiet', '--no-gpg-sign', '-m', 'ahead')
    expect(await maintenance.unpushedBranches(dir)).toEqual(['main'])
  })

  it('a dry run classifies like the real run without deleting', async () => {
    const gone = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const held = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    const goneCheckout = await makeWorkspace(gone)
    const heldCheckout = await makeWorkspace(held)
    await writeFile(join(heldCheckout, 'draft.txt'), 'unsaved\n')
    await age(goneCheckout, 2 * DAY)
    await age(heldCheckout, 2 * DAY)
    const old = new Date(Date.now() - 2 * DAY).toISOString()
    const shared = { now: Date.now(), chatRoot, stateRoot, home, trim: async () => null, claims: claimsFor('closed', old) }
    const dry = await maintenance.runStorageMaintenance({ ...shared, dryRun: true })
    await expect(lstat(goneCheckout)).resolves.toBeDefined()
    const real = await maintenance.runStorageMaintenance(shared)
    expect(dry.dryRun).toBe(true)
    expect(dry.removed).toEqual(real.removed)
    expect(dry.pruned).toEqual(real.pruned)
    expect(dry.held).toEqual(real.held)
    expect(dry.reclaimedBytes).toBe(real.reclaimedBytes)
    await expect(lstat(goneCheckout)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('bounded caches', () => {
  async function seed(dir: string, files: Array<{ name: string, bytes: number, ageMs: number }>): Promise<void> {
    await mkdir(dir, { recursive: true })
    for (const file of files) {
      const path = join(dir, file.name)
      await writeFile(path, 'x'.repeat(file.bytes))
      const at = new Date(Date.now() - file.ageMs)
      await utimes(path, at, at)
    }
  }

  it('caps a cache by evicting the least recently used files first', async () => {
    const pip = join(home, 'pip')
    await seed(pip, [
      { name: 'old', bytes: 100, ageMs: 2 * DAY },
      { name: 'new', bytes: 100, ageMs: 10 * 60_000 },
    ])
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: () => [], caps: { pip: 150, uv: 1, npm: 1, mirrors: 1 },
    })
    expect(report.caches).toHaveLength(1)
    expect(report.caches[0]).toMatchObject({ path: pip, bytes: 100 })
    await expect(lstat(join(pip, 'old'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(pip, 'new'))).resolves.toBeDefined()
  })

  it('never evicts fresh cache files', async () => {
    const pip = join(home, 'pip')
    await seed(pip, [{ name: 'hot', bytes: 100, ageMs: 1_000 }])
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: () => [], caps: { pip: 1, uv: 1, npm: 1, mirrors: 1 },
    })
    expect(report.caches).toHaveLength(0)
    expect(report.held.some((item) => item.path === pip && /in use/.test(item.reason))).toBe(true)
    await expect(lstat(join(pip, 'hot'))).resolves.toBeDefined()
  })

  it('caps mirrors by removing whole mirrors, oldest first', async () => {
    const mirrors = join(home, 'mirrors')
    await seed(join(mirrors, 'stale.git'), [{ name: 'pack', bytes: 100, ageMs: 2 * DAY }])
    await seed(join(mirrors, 'fresh.git'), [{ name: 'pack', bytes: 100, ageMs: 2 * DAY }])
    await age(join(mirrors, 'stale.git'), 2 * DAY)
    await age(join(mirrors, 'fresh.git'), 60_000)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null,
      claims: () => [], caps: { pip: 1, uv: 1, npm: 1, mirrors: 150 },
    })
    expect(report.caches.map((item) => item.path)).toEqual([join(mirrors, 'stale.git')])
    await expect(lstat(join(mirrors, 'stale.git'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(mirrors, 'fresh.git', 'pack'))).resolves.toBeDefined()
  })
})

describe('snapshot expiry', () => {
  it('expires incident snapshots unless pinned with KEEP', async () => {
    const snapshots = join(stateRoot, 'incident-recovery')
    await mkdir(join(snapshots, 'old'), { recursive: true })
    await writeFile(join(snapshots, 'old', 'dump'), 'x\n')
    await mkdir(join(snapshots, 'pinned'), { recursive: true })
    await writeFile(join(snapshots, 'pinned', 'KEEP'), '\n')
    await mkdir(join(snapshots, 'recent'), { recursive: true })
    await age(join(snapshots, 'old'), 31 * DAY)
    await age(join(snapshots, 'pinned'), 31 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null, claims: () => [],
    })
    expect(report.removed.map((item) => item.path)).toContain(join(snapshots, 'old'))
    expect(report.held.find((item) => item.path === join(snapshots, 'pinned'))?.reason).toMatch(/KEEP/)
    await expect(lstat(join(snapshots, 'old'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(snapshots, 'pinned', 'KEEP'))).resolves.toBeDefined()
    await expect(lstat(join(snapshots, 'recent'))).resolves.toBeDefined()
  })

  it('expires only old hex issue-review runs', async () => {
    const work = join(home, 'agent-work')
    const stale = join(work, 'a'.repeat(32))
    const fresh = join(work, 'b'.repeat(32))
    await mkdir(stale, { recursive: true })
    await mkdir(fresh, { recursive: true })
    await mkdir(join(work, 'notes'), { recursive: true })
    await age(stale, 8 * DAY)
    await age(join(work, 'notes'), 8 * DAY)
    const report = await maintenance.runStorageMaintenance({
      now: Date.now(), chatRoot, stateRoot, home, trim: async () => null, claims: () => [],
    })
    expect(report.removed.map((item) => item.path)).toContain(stale)
    await expect(lstat(stale)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(fresh)).resolves.toBeDefined()
    await expect(lstat(join(work, 'notes'))).resolves.toBeDefined()
  })
})

describe('disk pressure', () => {
  it('runs maintenance and alerts past the threshold, and resolves below the clear line', async () => {
    const alerts = await import('../server/alerts/store')
    let runs = 0
    const run = async () => {
      runs += 1
      return maintenance.runStorageMaintenance({ now: Date.now(), chatRoot, stateRoot, home, trim: async () => null, claims: () => [] })
    }
    const high = await maintenance.checkWorkspacePressure(home, async () => ({ blocks: 100, bsize: 1024, bavail: 15 }), run)
    expect(high).toMatchObject({ ran: true })
    expect(runs).toBe(1)
    expect(high.usedPercent).toBeCloseTo(85, 5)
    expect(alerts.openAlerts().some((alert) => alert.dedupeKey === 'workspace-storage-pressure')).toBe(true)
    // Cooldown: still pressured, but no second run.
    const again = await maintenance.checkWorkspacePressure(home, async () => ({ blocks: 100, bsize: 1024, bavail: 15 }), run)
    expect(again.ran).toBe(false)
    expect(runs).toBe(1)
    const low = await maintenance.checkWorkspacePressure(home, async () => ({ blocks: 100, bsize: 1024, bavail: 30 }), run)
    expect(low.ran).toBe(false)
    expect(alerts.openAlerts().some((alert) => alert.dedupeKey === 'workspace-storage-pressure')).toBe(false)
  })
})

describe('storage breakdown', () => {
  it('reports per-category sizes and disk totals', async () => {
    const checkout = await makeWorkspace('dddddddd-dddd-dddd-dddd-dddddddddddd')
    await writeFile(join(checkout, 'payload.bin'), 'x'.repeat(4096))
    const pip = join(home, 'pip')
    await mkdir(pip, { recursive: true })
    await writeFile(join(pip, 'wheel'), 'y'.repeat(2048))
    const breakdown = await maintenance.storageBreakdown(home, chatRoot, stateRoot)
    const byKey = new Map(breakdown.categories.map((category) => [category.key, category.bytes]))
    expect(byKey.get('chat-workers')).toBeGreaterThanOrEqual(4096)
    expect(byKey.get('pip')).toBeGreaterThanOrEqual(2048)
    expect(byKey.get('review-checkouts')).toBe(0)
    expect(breakdown.disk.totalBytes).toBeGreaterThan(0)
    expect(breakdown.disk.usedPercent).toBeGreaterThanOrEqual(0)
  })
})

describe('artifact restore', () => {
  it('reinstalls pruned node_modules with the lockfile installer', async () => {
    const id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    const checkout = await makeWorkspace(id)
    await writeFile(join(checkout, 'package.json'), '{"name":"x"}\n')
    await writeFile(join(checkout, 'package-lock.json'), '{"lockfileVersion":3}\n')
    await writeFile(join(chatRoot, 'workers', id, '.poise-maintenance.json'), JSON.stringify({ prunedAt: new Date().toISOString(), pruned: ['node_modules'] }))
    const calls: Array<{ command: string, args: readonly string[] }> = []
    const restored = await maintenance.restorePrunedArtifacts(checkout, chatRoot, async (command, args) => {
      calls.push({ command, args })
      return { stdout: '' }
    })
    expect(restored).toEqual(['node_modules'])
    expect(calls).toEqual([{ command: 'npm', args: ['ci', '--no-audit', '--no-fund'] }])
    await expect(lstat(join(chatRoot, 'workers', id, '.poise-maintenance.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('drops the marker even when reinstall fails', async () => {
    const id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    const checkout = await makeWorkspace(id)
    await writeFile(join(checkout, 'package.json'), '{"name":"x"}\n')
    await writeFile(join(chatRoot, 'workers', id, '.poise-maintenance.json'), JSON.stringify({ prunedAt: new Date().toISOString(), pruned: ['node_modules'] }))
    const restored = await maintenance.restorePrunedArtifacts(checkout, chatRoot, async () => { throw new Error('offline') })
    expect(restored).toEqual([])
    await expect(lstat(join(chatRoot, 'workers', id, '.poise-maintenance.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ignores checkouts outside workers/<id>/workspace', async () => {
    const dir = join(root, 'elsewhere')
    await mkdir(dir, { recursive: true })
    await expect(maintenance.restorePrunedArtifacts(dir, chatRoot, async () => { throw new Error('must not run') })).resolves.toEqual([])
  })
})

describe('session claims', () => {
  it('reads claims from the session table without parsing records', async () => {
    const storage = await import('../server/chat/storage')
    const checkout = await makeWorkspace('00000000-0000-0000-0000-000000000000')
    storage.insertSession({
      id: 'session-1', agent: 'codex', model: 'x', modelId: 'y', effort: 'medium', repo: '', checkout,
      branch: { name: 'chat/x', origin: 'new', provisional: true }, title: 't', instance: 'test',
      createdAt: new Date(Date.now() - 2 * DAY).toISOString(), updatedAt: new Date(Date.now() - 2 * DAY).toISOString(), status: 'closed',
    } as unknown as import('../server/chat/protocol').SessionRecord)
    expect(maintenance.claimsForCheckout(checkout)).toEqual([{
      sessionId: 'session-1', status: 'closed', updatedAt: expect.any(String), openTurn: false, queued: false,
    }])
    expect(await readdir(join(chatRoot, 'workers'))).toContain('00000000-0000-0000-0000-000000000000')
  })
})
