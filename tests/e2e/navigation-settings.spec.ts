import { expect, test, type Page } from '@playwright/test'
import { workspace } from './fixtures/workspace'

async function navigation(page: Page): Promise<void> {
  await page.locator('#menu-toggle').click()
  await page.locator('#menu-popover').getByRole('button', { name: 'Navigation', exact: true }).click()
  await expect(page.locator('#settings-panel .tp-title')).toHaveText('Navigation')
}

const shortcut = (page: Page, name: string, surface: 'menu' | 'top bar') => page.getByRole('checkbox', { name: `${name} in ${surface}`, exact: true })
const views = ['Current', 'Swarm', 'Chat', 'Archive', 'Behaviors', 'Snippets', 'Editor', 'Analytics', 'Logging']
async function add(page: Page, name: string, surface: 'menu' | 'top bar'): Promise<void> {
  if (await shortcut(page, name, surface).count()) return
  await page.getByRole('combobox', { name: `Add view to ${surface}`, exact: true }).selectOption({ label: name })
}


test('moves views between surfaces immediately, preserves active state and persists on reload', async ({ page }) => {
  await workspace(page, 'current', undefined, { preserveOnReload: true })
  await navigation(page)
  await expect(page.locator('.st-footer')).toBeHidden()
  await add(page, 'Current', 'menu')
  await shortcut(page, 'Current', 'top bar').click()
  await add(page, 'Analytics', 'top bar')
  await add(page, 'Logging', 'top bar')
  await shortcut(page, 'Analytics', 'menu').click()
  await page.getByRole('button', { name: 'Back to menu' }).click()
  await expect(page.locator('.menu-views .menu-item')).toHaveText(['Logging', 'Current'])
  await expect(page.locator('.menu-views [data-view="current"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#top-nav [data-view="current"]')).toHaveCount(0)
  await page.locator('#menu-toggle').click()
  await page.locator('#top-nav').getByRole('button', { name: 'Analytics', exact: true }).click()
  await expect(page.locator('#view-analytics')).toBeVisible()
  await expect(page.locator('#top-nav [data-view="analytics"]')).toHaveAttribute('aria-current', 'page')
  await page.locator('#view-analytics').getByRole('button', { name: 'Previous day' }).click()
  await expect(page.locator('#view-analytics .analytics-date')).toHaveText('Yesterday')
  await page.locator('#top-nav').getByRole('button', { name: 'Analytics', exact: true }).click()
  await expect(page.locator('#view-analytics .analytics-date')).toHaveText('Today')
  await page.locator('#top-nav').getByRole('button', { name: 'Logging', exact: true }).click()
  await expect(page.locator('#view-logging')).toBeVisible()
  await page.reload()
  await expect(page.locator('#view-logging')).toBeVisible()
  await expect(page.locator('#top-nav [data-view="logging"]')).toHaveAttribute('aria-current', 'page')
  await navigation(page)
  await expect(shortcut(page, 'Current', 'menu')).toBeChecked()
  await expect(shortcut(page, 'Current', 'top bar')).toHaveCount(0)
  await expect(shortcut(page, 'Analytics', 'menu')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset navigation' }).click()
  await expect(shortcut(page, 'Current', 'top bar')).toBeChecked()
  await expect(shortcut(page, 'Analytics', 'top bar')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('#top-nav .nav-item')).toHaveText(['Current', 'Swarm', 'Chat', 'Archive', 'Behaviors', 'Snippets', 'Editor'])
  await page.locator('#menu-toggle').click()
  await expect(page.locator('.menu-views .menu-item')).toHaveText(['Analytics', 'Logging'])
})

test('all view shortcuts can be hidden while Settings and keyboard access remain available', async ({ page }) => {
  await workspace(page)
  await navigation(page)
  for (const surface of ['menu', 'top bar'] as const) for (const name of views) {
    if (await shortcut(page, name, surface).count()) await shortcut(page, name, surface).click()
  }
  await expect(page.locator('#view-current')).toBeVisible()
  await expect(page.locator('#top-nav .nav-item')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to menu' }).click()
  await expect(page.locator('.menu-views .menu-item')).toHaveCount(0)
  await expect(page.locator('.menu-views-divider')).toBeHidden()
  await page.keyboard.press('Escape')
  await page.locator('#menu-toggle').press('ArrowDown')
  await expect(page.getByRole('button', { name: 'General', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.locator('#settings-panel .tp-title')).toHaveText('Navigation')
  await page.getByRole('button', { name: 'Reset navigation' }).click()
  await expect(page.locator('#top-nav .nav-item')).toHaveCount(7)
})

test('every view works as a menu shortcut and marks the selected page', async ({ page }) => {
  await workspace(page)
  await navigation(page)
  for (const name of views) await add(page, name, 'menu')
  for (const [key, label, id] of [
    ['chat', 'Chat', 'chat'], ['main', 'Archive', 'main'], ['behaviors', 'Behaviors', 'behaviors'],
    ['snippets', 'Snippets', 'snippets'], ['editor', 'Editor', 'editor'], ['swarm', 'Swarm', 'swarm'], ['current', 'Current', 'current'],
  ]) {
    await page.getByRole('button', { name: 'Back to menu' }).click()
    await page.locator('.menu-views').getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator(`#view-${id}`)).toBeVisible()
    await expect(page.locator('#menu-surface')).toBeHidden()
    await page.locator('#menu-toggle').click()
    await expect(page.locator(`.menu-views [data-view="${key}"]`)).toHaveAttribute('aria-current', 'page')
    await page.locator('#menu-popover').getByRole('button', { name: 'Navigation', exact: true }).click()
  }
})

test('a storage failure reports the unsaved choice and retains the working layout', async ({ page }) => {
  await workspace(page)
  await navigation(page)
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'poise-navigation') throw new Error('Storage is full')
      original.call(this, key, value)
    }
  })
  await shortcut(page, 'Current', 'top bar').click()
  await expect(shortcut(page, 'Current', 'top bar')).toBeChecked()
  await expect(page.locator('[data-tab="navigation"] [role="status"]')).toHaveText('Navigation was not saved: Storage is full')
  await expect(page.locator('#top-nav [data-view="current"]')).toBeVisible()
})

test('another tab updates both the navigation and its settings controls', async ({ page, context }) => {
  await workspace(page)
  await navigation(page)
  const other = await context.newPage()
  await other.route('**/navigation-tab', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Navigation preferences</title>' }))
  await other.goto('/navigation-tab')
  await other.evaluate(() => localStorage.setItem('poise-navigation', JSON.stringify({ current: { menu: true, topBar: false }, analytics: { menu: false, topBar: true }, topBarOrder: ['analytics', 'swarm'] })))
  await expect(shortcut(page, 'Current', 'top bar')).toHaveCount(0)
  await expect(shortcut(page, 'Current', 'menu')).toBeChecked()
  await expect(page.locator('#top-nav [data-view="analytics"]')).toBeVisible()
  await expect(page.locator('#top-nav .nav-item').first()).toHaveText('Analytics')
  await other.evaluate(() => localStorage.removeItem('poise-navigation'))
  await expect(shortcut(page, 'Current', 'top bar')).toBeChecked()
  await expect(page.locator('#top-nav [data-view="analytics"]')).toHaveCount(0)
})

for (const width of [420, 640, 900]) test(`all top bar shortcuts fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 820 })
  await workspace(page)
  await navigation(page)
  for (const name of views) await add(page, name, 'top bar')
  await page.locator('#menu-toggle').click()
  await expect(page.locator('#top-nav .nav-item')).toHaveCount(9)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  const logging = page.locator('#top-nav').getByRole('button', { name: 'Logging', exact: true })
  await logging.click()
  await expect(page.locator('#view-logging')).toBeVisible()
  await expect(page.locator('#menu-toggle')).toBeInViewport()
})

test('orders both surfaces independently, keeps keyboard focus and saves order across reloads', async ({ page }) => {
  await workspace(page, 'current', undefined, { preserveOnReload: true })
  await navigation(page)
  const menu = page.getByRole('group', { name: 'Menu shortcuts', exact: true })
  const topBar = page.getByRole('group', { name: 'Top bar shortcuts', exact: true })
  await expect(menu.getByRole('button', { name: 'Move Analytics up in menu', exact: true })).toBeDisabled()
  await expect(menu.getByRole('button', { name: 'Move Logging down in menu', exact: true })).toBeDisabled()
  await menu.getByRole('button', { name: 'Move Logging up in menu', exact: true }).click()
  await expect(menu.locator('label')).toHaveText(['Logging', 'Analytics'])
  const move = topBar.getByRole('button', { name: 'Move Current down in top bar', exact: true })
  await move.focus()
  await page.keyboard.press('Enter')
  await expect(move).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(topBar.locator('label')).toHaveText(['Swarm', 'Chat', 'Current', 'Archive', 'Behaviors', 'Snippets', 'Editor'])
  await expect(page.locator('[data-tab="navigation"] [role="status"]')).toHaveText('Current moved to position 3 in top bar.')
  await expect(page.locator('#top-nav .nav-item')).toHaveText(['Swarm', 'Chat', 'Current', 'Archive', 'Behaviors', 'Snippets', 'Editor'])
  await expect(page.locator('#view-current')).toBeVisible()
  await expect(page.locator('#top-nav [data-view="current"]')).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await page.locator('#menu-toggle').click()
  await expect(page.locator('.menu-views .menu-item')).toHaveText(['Logging', 'Analytics'])
  await expect(page.locator('#top-nav .nav-item')).toHaveText(['Swarm', 'Chat', 'Current', 'Archive', 'Behaviors', 'Snippets', 'Editor'])
  await page.locator('#menu-popover').getByRole('button', { name: 'Navigation', exact: true }).click()
  await page.getByRole('button', { name: 'Reset navigation' }).click()
  await expect(menu.locator('label')).toHaveText(['Analytics', 'Logging'])
  await expect(topBar.locator('label')).toHaveText(['Current', 'Swarm', 'Chat', 'Archive', 'Behaviors', 'Snippets', 'Editor'])
})
