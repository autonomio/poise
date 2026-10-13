import { expect, test } from '@playwright/test'
import { workspace } from './fixtures/workspace'
import { session, makeState, installRoutes, installSocket, input } from './fixtures/chat'
import { freeze, resume, settled } from './fixtures/motion'

test('closed menu retains its words until exit while focus and interaction close immediately', async ({ page }) => {
  await workspace(page)
  await page.locator('#menu-toggle').click()
  await page.locator('#menu-popover').getByRole('button', { name: 'General', exact: true }).click()
  await settled(page)
  const state = await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>('#menu-toggle')!.click()
    await new Promise<void>(resolve => queueMicrotask(resolve))
    const surface = document.querySelector<HTMLElement>('#menu-surface')!
    const panel = document.querySelector<HTMLElement>('#settings-panel')!
    return { hidden: surface.hidden, opacity: Number(getComputedStyle(surface).opacity), inert: surface.inert, display: getComputedStyle(panel).display, focused: document.activeElement?.id }
  })
  expect(state).toMatchObject({ hidden: false, inert: true, focused: 'menu-toggle' })
  expect(state.opacity).toBeGreaterThan(.5)
  expect(state.display).not.toBe('none')
  await page.locator('#menu-toggle').click()
  await settled(page)
  await expect(page.locator('#menu-popover')).toBeVisible()
  await expect(page.locator('#menu-surface')).not.toHaveAttribute('inert')
})

for (const narrow of [false, true]) test(`session controls retain focus and drafts through updates (${narrow ? 'narrow dark' : 'desktop light'})`, async ({ page }) => {
  if (narrow) await page.setViewportSize({ width: 640, height: 740 })
  await page.addInitScript(dark => { localStorage.clear(); localStorage.setItem('poise-view', 'chat'); if (dark) localStorage.setItem('poise-theme', 'dark') }, narrow)
  const record = session(), state = makeState([record])
  await installRoutes(page, state)
  const socket = await installSocket(page, state)
  await page.goto('/')
  await socket.subscribed(record.id)
  await settled(page)
  await input(page).fill('Unsent draft')
  const button = page.locator('.chat-session-delete')
  const original = await button.elementHandle()
  await button.focus()
  socket.push(record.id, { type: 'session.updated', session: { ...record, status: 'running', lastSeq: 1 } })
  await expect(page.locator('.chat-session-running')).toHaveCount(1)
  expect(await original!.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true)
  await expect(input(page)).toHaveValue('Unsent draft')
  await button.click()
  await expect(button).toHaveText('Sure?')
  expect(await original!.evaluate(element => document.activeElement === element)).toBe(true)
  expect(state.calls.filter(call => call.method === 'DELETE')).toHaveLength(0)
})

test('pointer takeover uses the moving sidebar width and releases the spring', async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('poise-view', 'chat'); localStorage.setItem('poise-chat-sidebar', 'collapsed') })
  await installRoutes(page, makeState([session()]))
  await installSocket(page)
  await page.goto('/')
  await settled(page)
  await page.getByRole('button', { name: 'Toggle sessions' }).click()
  await page.waitForFunction(() => { const width = document.querySelector('.chat-sidebar')!.getBoundingClientRect().width; return width > 30 && width < 240 })
  await freeze(page)
  const before = await page.locator('.chat-sidebar-resize').evaluate(element => {
    const box = element.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + 20, width: element.parentElement!.getBoundingClientRect().width }
  })
  await page.mouse.move(before.x, before.y)
  await page.mouse.down()
  await expect(page.locator('#view-chat')).toHaveClass(/chat-sidebar-resizing/)
  const after = await page.locator('.chat-sidebar').evaluate(element => element.getBoundingClientRect().width)
  expect(Math.abs(after - before.width)).toBeLessThan(1)
  await page.mouse.move(before.x + 40, before.y)
  await page.mouse.up()
  await resume(page)
  await settled(page)
  await expect(page.locator('#view-chat')).not.toHaveClass(/chat-sidebar-resizing/)
})

test('reduced motion removes feedback waits and settles active panels on preference, resize and print', async ({ page }) => {
  await workspace(page)
  await page.locator('#menu-toggle').click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await settled(page)
  await expect(page.locator('#menu-surface')).toHaveCSS('opacity', '1')
  const delay = await page.evaluate(() => {
    const content = document.createElement('div'); content.className = 'ni-content ni-arriving'; document.body.append(content)
    const value = getComputedStyle(content).transitionDelay; content.remove(); return value
  })
  expect(delay.split(',').every(value => parseFloat(value) === 0)).toBe(true)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('#menu-popover').getByRole('button', { name: 'Accounts', exact: true }).click()
  await page.setViewportSize({ width: 520, height: 640 })
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await settled(page)
  expect(await page.locator('#menu-surface').evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.getBoundingClientRect().left >= 0)).toBe(true)
})

test('repeated Archive reorders retain actors and have no stale cleanup jump', async ({ page }) => {
  await workspace(page, 'main')
  let order = [1, 2, 3]
  await page.route('**/api/gh', route => route.fulfill({ json: { records: order.map(number => ({ repo: 'acme/app', number, kind: 'pr', title: `Motion row ${number}`, url: `https://github.com/acme/app/pull/${number}`, author: 'octocat', state: 'open', owner_login: null, owner_avatar: null, updated_at: '2026-10-13T10:00:00Z', merged_at: null })), count: 3, errors: [] } }))
  await page.evaluate(() => localStorage.setItem('poise-view', 'main'))
  await page.reload()
  await expect(page.locator('#tbody > tr')).toHaveCount(3)
  await settled(page)
  const original = await page.locator('#tbody > tr').first().elementHandle()
  order = [3, 2, 1]
  await page.evaluate(() => window.dispatchEvent(new Event('poise:refresh-tick')))
  await expect(page.locator('#tbody > tr').first()).toContainText('Motion row 3')
  await page.waitForTimeout(500)
  order = [1, 2, 3]
  await page.evaluate(() => window.dispatchEvent(new Event('poise:refresh-tick')))
  await expect(page.locator('#tbody > tr').first()).toContainText('Motion row 1')
  const positions = await page.locator('#tbody > tr').first().evaluate(async element => {
    const samples: Array<{ t: number, y: number }> = [], start = performance.now()
    await new Promise<void>(resolve => { const frame = () => { samples.push({ t: performance.now() - start, y: element.getBoundingClientRect().top }); if (performance.now() - start < 800) requestAnimationFrame(frame); else resolve() }; requestAnimationFrame(frame) })
    return samples
  })
  const jumps = positions.slice(1).filter((sample, i) => sample.t - positions[i].t < 35).map(sample => { const i = positions.indexOf(sample); return Math.abs(sample.y - positions[i - 1].y) })
  expect(Math.max(...jumps)).toBeLessThan(25)
  expect(await original!.evaluate(element => element.isConnected && element === document.querySelector('#tbody > tr'))).toBe(true)
  await settled(page)
  expect(await page.locator('#tbody > tr').evaluateAll(rows => rows.every(row => !row.hasAttribute('data-flow-layout')))).toBe(true)
})
