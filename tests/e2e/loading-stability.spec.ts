import { expect, test, type Page } from '@playwright/test'
import { ACCOUNT_IDS, ACCOUNT_LOGINS } from '../../server/accounts/types'
import { workspace } from './fixtures/workspace'
import { settled } from './fixtures/motion'
import { AGENTS, installSocket } from './fixtures/chat'

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function settings(page: Page, section: string) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.locator('#menu-popover').getByRole('button', { name: section, exact: true }).click()
}

const destinations = [
  ['Current', 'current', '/api/current'], ['Swarm', 'swarm', '/api/agent-logs'],
  ['Chat', 'chat', '/api/chat/sessions'], ['Archive', 'main', '/api/gh'],
  ['Behaviors', 'behaviors', '/api/behaviors'], ['Snippets', 'snippets', '/api/snippets'],
  ['Editor', 'editor', '/api/editor/docs'],
] as const

for (const [label, slug, path] of destinations) test(`${label} permits navigation while its read is pending and after it fails`, async ({ page }) => {
  await workspace(page, slug === 'current' ? 'main' : 'current')
  await settled(page)
  await installSocket(page)
  await page.route('**/api/chat/agents', route => route.fulfill({ json: AGENTS }))
  const held = deferred(), errors: string[] = []
  let reads = 0, editorWrites = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`**${path}**`, async route => {
    reads++
    if (slug === 'editor' && route.request().method() !== 'GET') editorWrites++
    await held.promise
    await route.fulfill({ status: 503, json: { error: 'Source unavailable' } })
  })
  try {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator(`#view-${slug}`)).toBeVisible()
    await expect.poll(() => reads).toBeGreaterThan(0)
    const next = slug === 'current' ? 'main' : 'current'
    const elapsed = await page.evaluate(next => new Promise<number>(resolve => {
      requestAnimationFrame(() => {
        const start = performance.now()
        document.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)!.click()
        requestAnimationFrame(() => resolve(performance.now() - start))
      })
    }), next)
    expect(elapsed).toBeLessThan(1000)
    await expect(page.locator(`#view-${next}`)).toBeVisible()
    const failed = page.waitForResponse(response => new URL(response.url()).pathname === path && response.status() === 503)
    held.release()
    await (await failed).finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.locator(`#view-${next}`)).toBeVisible()
    expect(errors).toEqual([])
    expect(editorWrites).toBe(0)
  } finally { held.release() }
})

test('Settings isolates slow Models and account probes while retaining fast account results', async ({ page }) => {
  await workspace(page); await settled(page)
  const modelRead = deferred(), githubRead = deferred()
  let models = 0, accountReads = 0, failed = true
  const accounts = ACCOUNT_IDS.map(id => ({ id, installed: true, version: '1.2.3', signedIn: true, identity: `${id}-user`, detail: null, login: { label: ACCOUNT_LOGINS[id].join(' ') } }))
  await page.route('**/api/models', async route => {
    models++
    await modelRead.promise
    await route.fulfill({ json: { catalog: { models: [], review_providers: [] }, places: [], fixed: [], presets: [], refresh: null } })
  })
  await page.route('**/api/accounts**', async route => {
    accountReads++
    const id = new URL(route.request().url()).searchParams.get('id')
    if (id === 'gh') {
      await githubRead.promise
      if (failed) return route.fulfill({ status: 502, json: { error: 'GitHub probe unavailable' } })
    }
    await route.fulfill({ json: { accounts: accounts.filter(account => !id || account.id === id) } })
  })
  try {
    await settings(page, 'General')
    await expect(page.getByLabel('Your GitHub account', { exact: true })).toHaveValue('octocat')
    await settled(page)
    expect({ models, accountReads }).toEqual({ models: 0, accountReads: 0 })
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click()
    await page.locator('#menu-popover').getByRole('button', { name: 'Models', exact: true }).click()
    await expect.poll(() => models).toBe(1)
    await expect(page.locator('.st-models')).toContainText('Loading the catalog')
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click()
    await page.locator('#menu-popover').getByRole('button', { name: 'Accounts', exact: true }).click()
    await expect(page.locator('.st-account[data-account="codex"]')).toContainText('codex-user')
    await expect(page.locator('.st-accounts-status')).toContainText('gh')
    await expect(page.locator('.st-account[data-account="gh"]')).toHaveCount(0)
    expect(models).toBe(1)
    githubRead.release()
    await expect(page.locator('.st-accounts-status')).toContainText('GitHub probe unavailable')
    await expect(page.locator('.st-account[data-account="codex"]')).toContainText('codex-user')
    failed = false
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click()
    await page.locator('#menu-popover').getByRole('button', { name: 'Accounts', exact: true }).click()
    await expect(page.locator('.st-account[data-account="gh"]')).toContainText('gh-user')
    await expect(page.locator('.st-accounts-status')).toBeEmpty()
  } finally { modelRead.release(); githubRead.release() }
})

test('a late Behaviors read cannot restart hidden polling and its cached state appears on return', async ({ page }) => {
  await workspace(page); await settled(page)
  const first = deferred(), second = deferred()
  let reads = 0
  await page.route('**/api/behaviors', async route => {
    await (++reads === 1 ? first.promise : second.promise)
    await route.fulfill({ json: { 'review-new-prs': { enabled: true, owner: 'cached-agent', setting: 'p2', reviewers: 1 } } })
  })
  try {
    await page.getByRole('button', { name: 'Behaviors', exact: true }).click()
    await expect(page.locator('#behaviors-tbody > tr')).not.toHaveCount(0)
    await expect(page.locator('input[data-behavior="review-new-prs"]')).toBeDisabled()
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    const received = page.waitForResponse('**/api/behaviors')
    first.release(); await (await received).finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.evaluate(() => window.dispatchEvent(new Event('poise:refresh-tick')))
    await page.waitForTimeout(100)
    expect(reads).toBe(1)
    await page.getByRole('button', { name: 'Behaviors', exact: true }).click()
    await expect.poll(() => reads).toBe(2)
    await expect(page.locator('input[data-behavior="review-new-prs"]')).toBeChecked()
    await expect(page.locator('tr[data-behavior="review-new-prs"]')).toContainText('cached-agent')
  } finally { first.release(); second.release() }
})

test('Editor retains its document actor and undo history while the picker refresh is pending', async ({ page }) => {
  await workspace(page); await settled(page)
  const picker = deferred(), version = 'e'.repeat(64)
  let lists = 0, documentReads = 0
  await page.route('**/api/editor/docs', async route => {
    if (++lists > 1) await picker.promise
    await route.fulfill({ json: { docs: [{ slug: 'notes', title: 'Notes', updatedAt: '2026-10-14T08:00:00Z', size: 13 }] } })
  })
  await page.route('**/api/editor/doc/notes', async route => {
    if (route.request().method() === 'GET') documentReads++
    await route.fulfill({ json: { slug: 'notes', content: '# Notes\n\nOriginal', version, title: 'Notes' } })
  })
  await page.route('**/api/editor/doc/notes/annotations', route => route.fulfill({ json: { annotations: [], version } }))
  try {
    await page.getByRole('button', { name: 'Editor', exact: true }).click()
    const doc = page.locator('#editor-doc')
    await expect(doc).toContainText('Original')
    const actor = await doc.locator('.editor-line').first().elementHandle()
    await doc.click(); await doc.press('ControlOrMeta+End'); await doc.pressSequentially(' kept')
    await expect(doc).toContainText('kept')
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    await page.getByRole('button', { name: 'Editor', exact: true }).click()
    await expect.poll(() => lists).toBe(2)
    await expect(doc).toContainText('kept')
    expect(documentReads).toBe(1)
    expect(await actor!.evaluate(element => element.isConnected)).toBe(true)
    await doc.click(); await doc.press('ControlOrMeta+z')
    await expect(doc).not.toContainText('kept')
  } finally { picker.release() }
})
