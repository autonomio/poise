import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { workspace } from './fixtures/workspace'

// The entry bootstrap (#789, PR 1 of #556): which interface loads, the
// recovery address, and the visible fallback when the new interface fails.
// `src/ui/app` is a placeholder until PR 7, so the `new` branch always falls
// back; the fallback naming the placeholder's own failure proves the branch
// ran.

const FALLBACK_TITLE = 'The new interface could not load'
const PLACEHOLDER_MARKER = 'not part of this build'

async function storeInterface(page: Page, value: string | null): Promise<void> {
  await page.addInitScript((stored) => {
    if (stored === null) localStorage.removeItem('poise-interface')
    else localStorage.setItem('poise-interface', stored)
  }, value)
}

async function scriptUrls(page: Page): Promise<string[]> {
  const urls: string[] = []
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') urls.push(response.url())
  })
  return urls
}

async function urlsWithMarker(request: APIRequestContext, urls: string[]): Promise<string[]> {
  const found: string[] = []
  for (const url of [...new Set(urls)]) {
    const response = await request.get(url)
    if (response.ok() && (await response.text()).includes(PLACEHOLDER_MARKER)) found.push(url)
  }
  return found
}

test('served entry carries an empty mount', async ({ page }) => {
  const response = await page.request.get('/')
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html).toContain('<div id="app"></div>')
  expect(html).not.toContain('id="view-')
})

test('unset storage loads classic', async ({ page }) => {
  await workspace(page, 'current')
  await expect(page.locator('html[data-interface="classic"]')).toBeAttached()
  await expect(page.locator('#view-current')).toBeVisible()
  await page.locator('#notification-bell').click()
  await expect(page.locator('#notification-rail')).not.toContainText(FALLBACK_TITLE)
})

test('classic storage loads classic without the new chunk', async ({ page }) => {
  await workspace(page, 'current')
  await storeInterface(page, 'classic')
  const urls = await scriptUrls(page)
  await page.reload()
  await expect(page.locator('html[data-interface="classic"]')).toBeAttached()
  await expect(page.locator('#view-current')).toBeVisible()
  expect(await urlsWithMarker(page.request, urls)).toEqual([])
})

test('new storage falls back to classic visibly', async ({ page }) => {
  await workspace(page, 'current')
  await storeInterface(page, 'new')
  await page.reload()
  await expect(page.locator('html[data-interface="new"]')).toBeAttached()
  await expect(page.locator('#view-current')).toBeVisible()
  await page.locator('#notification-bell').click()
  await expect(page.locator('#notification-rail')).toContainText(FALLBACK_TITLE)
  await expect(page.locator('#notification-rail')).toContainText(PLACEHOLDER_MARKER)
})

test('recovery address saves the classic choice', async ({ page }) => {
  await workspace(page, 'current')
  await storeInterface(page, 'new')
  await page.goto('/?interface=classic')
  await expect(page.locator('html[data-interface="classic"]')).toBeAttached()
  await expect(page.locator('#view-current')).toBeVisible()
  await page.locator('#notification-bell').click()
  await expect(page.locator('#notification-rail')).not.toContainText(FALLBACK_TITLE)
  expect(await page.evaluate(() => localStorage.getItem('poise-interface'))).toBe('classic')
})

test('failed new import falls back to classic visibly', async ({ page }) => {
  await workspace(page, 'current')
  await storeInterface(page, 'new')
  const urls = await scriptUrls(page)
  await page.reload()
  await page.locator('#notification-bell').click()
  await expect(page.locator('#notification-rail')).toContainText(FALLBACK_TITLE)
  const chunks = await urlsWithMarker(page.request, urls)
  expect(chunks).toHaveLength(1)
  await page.route(chunks[0], (route) => route.abort())
  await page.reload()
  await expect(page.locator('html[data-interface="new"]')).toBeAttached()
  await expect(page.locator('#view-current')).toBeVisible()
  await page.locator('#notification-bell').click()
  await expect(page.locator('#notification-rail')).toContainText(FALLBACK_TITLE)
})

test('settings deep link survives the bootstrap', async ({ page }) => {
  await workspace(page, 'current')
  await page.goto('/?settings=accounts')
  await expect(page.locator('#settings-panel')).toHaveClass(/open/)
  await expect(page.locator('#settings-panel')).toHaveAttribute('data-section', 'accounts')
})
