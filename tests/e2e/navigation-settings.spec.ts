import { expect, test, type Page } from '@playwright/test'
import { workspace } from './fixtures/workspace'

async function navigation(page: Page): Promise<void> {
  await page.locator('#menu-toggle').click()
  await page.locator('#menu-popover').getByRole('button', { name: 'Navigation', exact: true }).click()
  await expect(page.locator('#settings-panel .tp-title')).toHaveText('Navigation')
}

const shortcut = (page: Page, name: string, surface: 'menu' | 'top bar') => page.getByRole('checkbox', { name: `${name} in ${surface}`, exact: true })

test('moves views between surfaces immediately, preserves active state and persists on reload', async ({ page }) => {
  await workspace(page, 'current', undefined, { preserveOnReload: true })
  await navigation(page)
  await expect(page.locator('.st-footer')).toBeHidden()
  await shortcut(page, 'Current', 'menu').check()
  await shortcut(page, 'Current', 'top bar').uncheck()
  await shortcut(page, 'Analytics', 'top bar').check()
  await shortcut(page, 'Logging', 'top bar').check()
  await shortcut(page, 'Analytics', 'menu').uncheck()
  await page.getByRole('button', { name: 'Back to menu' }).click()
  await expect(page.locator('.menu-views .menu-item')).toHaveText(['Current', 'Logging'])
  await expect(page.locator('.menu-views [data-view="current"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#top-nav [data-view="current"]')).toHaveCount(0)
  await page.locator('#menu-toggle').click()
  await page.locator('#top-nav').getByRole('button', { name: 'Analytics', exact: true }).click()
  await expect(page.locator('#view-analytics')).toBeVisible()
  await expect(page.locator('#top-nav [data-view="analytics"]')).toHaveAttribute('aria-current', 'page')
  await page.locator('#top-nav').getByRole('button', { name: 'Logging', exact: true }).click()
  await expect(page.locator('#view-logging')).toBeVisible()
  await page.reload()
  await expect(page.locator('#view-logging')).toBeVisible()
  await expect(page.locator('#top-nav [data-view="logging"]')).toHaveAttribute('aria-current', 'page')
  await navigation(page)
  await expect(shortcut(page, 'Current', 'menu')).toBeChecked()
  await expect(shortcut(page, 'Current', 'top bar')).not.toBeChecked()
  await expect(shortcut(page, 'Analytics', 'menu')).not.toBeChecked()
  await page.getByRole('button', { name: 'Reset navigation' }).click()
  await expect(shortcut(page, 'Current', 'top bar')).toBeChecked()
  await expect(shortcut(page, 'Analytics', 'top bar')).not.toBeChecked()
  await page.reload()
  await expect(page.locator('#top-nav .nav-item')).toHaveText(['Current', 'Swarm', 'Chat', 'Archive', 'Behaviors', 'Snippets', 'Editor'])
  await page.locator('#menu-toggle').click()
  await expect(page.locator('.menu-views .menu-item')).toHaveText(['Analytics', 'Logging'])
})

test('all view shortcuts can be hidden while Settings and keyboard access remain available', async ({ page }) => {
  await workspace(page)
  await navigation(page)
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck()
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
  for (const checkbox of await page.locator('[data-surface="menu"]').all()) await checkbox.check()
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
  await shortcut(page, 'Current', 'top bar').uncheck()
  await expect(shortcut(page, 'Current', 'top bar')).toBeChecked()
  await expect(page.locator('[data-tab="navigation"] [role="status"]')).toHaveText('Navigation was not saved: Storage is full')
  await expect(page.locator('#top-nav [data-view="current"]')).toBeVisible()
})
