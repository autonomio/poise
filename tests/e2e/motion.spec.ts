import { expect, test } from '@playwright/test'
import { workspace } from './fixtures/workspace'
import { session, makeState, installRoutes, installSocket, input, env } from './fixtures/chat'
import { freeze, resume, settled, stableLanding } from './fixtures/motion'

test('Current keeps each empty-lane explanation through background refreshes', async ({ page }) => {
  await workspace(page)
  await page.locator('#current-status-filter [data-status="all"]').click()
  await page.locator('#current-time-picker [data-time="all"]').click()
  const notes = page.locator('#view-current .lane[data-lane-type="live"] .lane-empty')
  await expect(notes).toHaveText(['Nothing here.', 'Nothing here.'])
  await settled(page)
  let refreshes = 0
  await page.route('**/api/agent-logs**', route => { refreshes++; return route.fulfill({ json: { logs: [] } }) })
  for (const query of ['', 'missing']) {
    await page.locator('#current-search').fill(query)
    const explanation = query ? 'Nothing matches the current filter.' : 'Nothing here.'
    await expect(notes).toHaveText([explanation, explanation])
    const original = await notes.first().elementHandle()
    const before = refreshes
    await page.evaluate(() => window.dispatchEvent(new Event('poise:refresh-tick')))
    await expect.poll(() => refreshes).toBeGreaterThan(before)
    await expect(notes).toHaveText([explanation, explanation])
    expect(await original!.evaluate(element => element.isConnected)).toBe(true)
  }
})

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

test('swapping a notice during entrance keeps its presented position', async ({ page }) => {
  await workspace(page)
  const notices: import('../../src/notices').Notice[] = ['First notice', 'Second notice'].map((title, index) => ({ id: `motion-${index}`, kind: 'chat_turn_finished', title, body: 'Browser fixture', since: '2026-10-13T10:00:00Z', due: '2026-10-13T10:00:00Z', silenceable: false, target: null }))
  await page.route('**/api/notices', route => route.fulfill({ json: { enabled: true, notices } }))
  await page.reload()
  const result = await page.evaluate(() => new Promise<{ before: number, after: number, inert: boolean }>((resolve, reject) => {
    const start = performance.now()
    const frame = () => {
      const actor = document.querySelector<HTMLElement>('.ni-content')
      const y = actor ? parseFloat(actor.style.getPropertyValue('--flow-enter-y')) : NaN
      if (actor && y > 1 && y < 7) {
        const before = actor.getBoundingClientRect().top
        actor.querySelector<HTMLButtonElement>('[data-action="next"]')!.click()
        resolve({ before, after: actor.getBoundingClientRect().top, inert: actor.inert })
      } else if (performance.now() - start < 5000) requestAnimationFrame(frame)
      else reject(new Error('Notice did not enter.'))
    }
    requestAnimationFrame(frame)
  }))
  expect(result.after).toBe(result.before)
  expect(result.inert).toBe(true)
  await settled(page)
  await expect(page.locator('.ni-title')).toHaveText('Second notice')
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
  await button.press('Enter')
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

test('a model menu lands once and keeps its catalogue visible', async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('poise-view', 'chat') })
  await installRoutes(page, makeState([])); await installSocket(page)
  await page.goto('/')
  await page.locator('.chat-default-model').click()
  await expect(page.locator('.chat-model-menu [data-identity]')).toHaveCount(10)
  await stableLanding(page.locator('.chat-model-menu'))
  await expect(page.locator('.chat-model-menu')).toBeVisible()
})

test('the final streamed response updates while selected text stays selected', async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('poise-view', 'chat') })
  await installRoutes(page, makeState([session({ status: 'running' })], { s1: [env('s1', 1, { type: 'turn.started', turnId: 't1', prompt: { text: 'go', attachments: [], mentions: [] } })] }))
  const socket = await installSocket(page)
  await page.goto('/'); await socket.subscribed('s1'); socket.seq = 1
  socket.push('s1', { type: 'text.delta', turnId: 't1', messageId: 'm1', delta: 'Selected words' })
  const message = page.locator('.chat-item-text .chat-msg-md')
  await expect(message).toHaveText('Selected words')
  await message.evaluate(element => {
    const text = element.querySelector('p')!.firstChild!
    window.getSelection()!.setBaseAndExtent(text, 0, text, 8)
  })
  socket.push('s1', { type: 'text.delta', turnId: 't1', messageId: 'm1', delta: ' and the final update.' })
  socket.push('s1', { type: 'turn.finished', turnId: 't1', stopReason: 'end_turn' })
  await expect(message).toHaveText('Selected words and the final update.')
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('Selected')
  await page.evaluate(() => window.getSelection()!.removeAllRanges())
  await expect(message).toHaveText('Selected words and the final update.')
})

test('draft typing resizes immediately without a delayed height transition', async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('poise-view', 'chat') })
  await installRoutes(page, makeState([session()])); await installSocket(page)
  await page.goto('/'); await settled(page)
  const measurements = await input(page).evaluate(async element => {
    const textarea = element as HTMLTextAreaElement
    const results: Array<{ expected: number, actual: number, interpolating: boolean }> = []
    for (const draft of [Array(10).fill('Typing line').join('\n'), 'Short draft']) {
      textarea.value = draft; textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => requestAnimationFrame(resolve))
      results.push({ expected: parseFloat(element.style.height), actual: parseFloat(getComputedStyle(element).height), interpolating: element.getAnimations().some(animation => animation.playState === 'running') })
    }
    return results
  })
  for (const sample of measurements) {
    expect(Math.abs(sample.actual - sample.expected)).toBeLessThan(1)
    expect(sample.interpolating).toBe(false)
  }
  expect(measurements[0].actual).toBeGreaterThan(measurements[1].actual)
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
  await page.route('**/api/gh', route => route.fulfill({ json: { records: order.map(number => ({ repo: 'acme/app', number, kind: 'pr', title: `Motion row ${number}`, url: `https://github.com/acme/app/pull/${number}`, author: 'octocat', state: 'open', owner_login: null, owner_avatar: null, updated_at: '2026-10-13T10:00:00Z', merged_at: null })), count: order.length, errors: [] } }))
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
  order = [4, 1, 2, 3]
  await page.evaluate(() => window.dispatchEvent(new Event('poise:refresh-tick')))
  await expect(page.locator('#tbody > tr').first()).toContainText('Motion row 4')
  const landing = await page.locator('#tbody > tr').first().evaluate(async row => {
    let opaque = false, minimum = 1, completedAt: number | undefined
    const started = performance.now()
    await new Promise<void>(resolve => {
      const frame = () => {
        const now = performance.now(), opacity = Number(getComputedStyle(row).opacity)
        if (opacity >= .99) opaque = true
        if (opaque) minimum = Math.min(minimum, opacity)
        if (!row.hasAttribute('data-motion-running') && completedAt === undefined) completedAt = now
        if ((completedAt === undefined || now - completedAt < 200) && now - started < 5000) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    return { opaque, minimum, completed: completedAt !== undefined }
  })
  expect(landing.opaque).toBe(true)
  expect(landing.completed).toBe(true)
  expect(landing.minimum).toBeGreaterThan(.9)
})
