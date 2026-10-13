import { expect, test, type Page } from '@playwright/test'

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

const issue = {
  repo: 'acme/project', number: 7, title: 'Available GitHub issue', kind: 'issue',
  state: 'open', url: 'https://github.com/acme/project/issues/7', author: 'octocat',
  updated_at: '2026-10-13T08:00:00Z', created_at: '2026-10-13T08:00:00Z', merged_at: null,
}

async function setup(page: Page, view = 'current') {
  const state = { currentReads: 0 }
  await page.addInitScript((initialView) => {
    localStorage.clear()
    localStorage.setItem('poise-view', initialView)
  }, view)
  await page.route(/https:\/\/(?:rsms\.me|fonts\.googleapis\.com|fonts\.gstatic\.com|github\.com)\//, (route) => route.abort())
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/settings') return route.fulfill({ json: {
      org: 'acme', me: 'octocat', timezone: 'UTC', models: {},
      organizations: ['acme', 'beta'].map((login) => ({ login, status: 'ready', managed: true, stage: 'ready', error: null, activatedAt: null })),
    } })
    if (path === '/api/current') return route.fulfill({ json: { cards: [{
      id: 1, text: 'Available personal card', lane: 'plan', position: 0, repo: null,
      created_at: issue.created_at, updated_at: issue.updated_at,
    }] } })
    if (path === '/api/gh') {
      const body = route.request().postDataJSON() as { operation?: string, count_only?: boolean, limit?: number }
      if (body.limit === 201) state.currentReads++
      return route.fulfill({ json: body.count_only ? { count: 1 } : { records: body.operation === 'green_pr' ? [] : [issue] } })
    }
    if (path === '/api/repos') return route.fulfill({ json: { repos: ['acme/project'] } })
    if (path === '/api/agent-logs') return route.fulfill({ json: { logs: [] } })
    return route.fulfill({ json: {} })
  })
  return state
}

test('Current paints cards while repository discovery and agent activity remain pending', async ({ page }) => {
  await setup(page)
  const auxiliary = deferred()
  await page.route(/\/api\/(?:repos|agent-logs)(?:\?.*)?$/, async (route) => {
    await auxiliary.promise
    await route.fallback()
  })
  const start = Date.now()
  try {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Edit card: Available personal card', exact: true })).toBeVisible({ timeout: 2000 })
    await expect(page.getByRole('link', { name: /Available GitHub issue/ })).toBeVisible({ timeout: 2000 })
    console.log(`Current first cards: ${Date.now() - start}ms; repository/activity responses still held`)
    // A late auxiliary read must not recreate the card's open composer.
    await page.getByRole('button', { name: 'Add a card to Idea', exact: true }).click()
    await page.getByPlaceholder('Write a card...').fill('Unsaved idea')
    auxiliary.release()
    await expect(page.getByPlaceholder('Write a card...')).toHaveValue('Unsaved idea')
  } finally { auxiliary.release() }
})

test('Current paints personal cards before a delayed GitHub failure and preserves them afterward', async ({ page }) => {
  await setup(page)
  const live = deferred()
  await page.route('**/api/gh', async (route) => {
    await live.promise
    await route.fulfill({ status: 502, json: { error: 'Datastore unavailable' } })
  })
  try {
    await page.goto('/')
    const card = page.getByRole('button', { name: 'Edit card: Available personal card', exact: true })
    await expect(card).toBeVisible({ timeout: 2000 })
    live.release()
    await expect(page.locator('#view-current')).toContainText('Could not load GitHub issues and pull requests.')
    await expect(card).toBeVisible()
  } finally { live.release() }
})

test('a late Current initialization cannot restart polling after navigation away', async ({ page }) => {
  const state = await setup(page)
  const repos = deferred()
  await page.route(/\/api\/repos(?:\?.*)?$/, async (route) => {
    await repos.promise
    await route.fallback()
  })
  try {
    await page.goto('/')
    await expect(page.getByRole('link', { name: /Available GitHub issue/ })).toBeVisible({ timeout: 2000 })
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    repos.release()
    await expect(page.locator('#tbody')).toContainText('Available GitHub issue')
    const before = state.currentReads
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('poise:refresh-tick')))
    await expect.poll(() => state.currentReads).toBe(before)
  } finally { repos.release() }
})

test('Archive paints rows before its total-count response and reports a late count failure', async ({ page }) => {
  await setup(page, 'main')
  const count = deferred()
  await page.route('**/api/gh', async (route) => {
    const body = route.request().postDataJSON() as { count_only?: boolean }
    if (!body.count_only) return route.fallback()
    await count.promise
    await route.fulfill({ status: 502, json: { error: 'Count unavailable' } })
  })
  const start = Date.now()
  try {
    await page.goto('/')
    await expect(page.locator('#tbody')).toContainText('Available GitHub issue', { timeout: 2000 })
    console.log(`Archive first rows: ${Date.now() - start}ms; total-count response still held`)
    count.release()
    await expect(page.locator('#view-main')).toContainText('Total count unavailable.')
    await expect(page.locator('#tbody')).toContainText('Available GitHub issue')
  } finally { count.release() }
})
