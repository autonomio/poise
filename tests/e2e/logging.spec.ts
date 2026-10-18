import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { normalize, type LogEvent } from '../../gateway/src/diagnostics/contract'
import { callerDiagnostic } from '../../gateway/src/diagnostics/sources'
import { DiagnosticStore, DEFAULT_LOG_POLICY } from '../../gateway/src/diagnostics/store'
import { workspace } from './fixtures/workspace'

const storePath = resolve('test-results/e2e/logging.db')
const component = 'logging-fixture'
const callId = (index: number) => (index + 1).toString(16).padStart(32, '0')
const fixtures: LogEvent[] = []
const lateIds: string[] = []
const prefs = { component, workspace: '', account: '', repository: '', callId: '', correlationId: '', incidentId: '',
  severities: ['critical', 'error', 'warning'], time: 'all', from: '', to: '', source: '', search: '', scope: 'workspace' }
const rows = (page: Page) => page.locator('#logging-tbody > tr.agent-row')
const status = (page: Page) => page.locator('#logging-status')
const action = (page: Page, key: string) => page.locator(`#view-logging [data-action="${key}"]`).first()
async function ready(page: Page, path?: string, timezone = 'UTC'): Promise<void> {
  await workspace(page, 'current', undefined, { preserveOnReload: true, realLogging: true, timezone })
  await page.evaluate((value) => localStorage.setItem('poise-logging-filters', JSON.stringify(value)), prefs)
  const started = await page.evaluate(() => performance.now())
  if (path) await page.goto(path)
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.locator('#menu-popover [data-action="logging"]').click()
  }
  await expect(status(page)).toContainText('matching retained events')
  await expect(page.locator('#logging-loader')).toBeHidden()
  if (!path) await page.evaluate((started) => Object.assign(window, { loggingNavigationMs: performance.now() - started }), started)
}

// Only this file uses the real API/store; other browser fixtures intercept it.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => {
  const now = Date.now()
  for (let index = 0; index < 120; index++) {
    const input = callerDiagnostic({ id: callId(index), completed_at: index === 60 ? null : new Date(now - (index >= 110 ? 300_000 : (120 - index) * 20_000)).toISOString(),
      behavior: component, repo: 'acme/repo', pr_id: '42', actor: 'octocat', outcome: 'failed', error: 'fetch failed token=fixture-secret',
      diagnostic: { version: 1, severity: 'error', operation: 'git.fetch', phase: 'checkout', stderr: 'fatal: retained stderr token=fixture-secret',
        context: { exit_code: 128, timeout_seconds: 15, elapsed_ms: 23, provider_started: false } } }, 'local')!
    fixtures.push(normalize({ ...input, condition: 'fixture-fetch', cause: ['underlying retained cause', 'x'.repeat(512)], resources: { usedBytes: 42, measuredAt: new Date(now - 1000).toISOString(), measurement: 'statfs' } }, now, ['fixture-secret'])!)
  }
  for (const level of ['critical', 'warning']) fixtures.push(normalize({ id: 'fixture-' + level, component, source: 'poise', level, operation: 'fixture', workspace: 'local', message: level + ' representative evidence' }, now)!)
  const foreign = normalize({ id: 'fixture-bob', component, source: 'caller', level: 'error', operation: 'fetch', workspace: 'bob', message: 'never reveal bob-private-evidence' }, now)!
  const db = new DiagnosticStore(storePath, DEFAULT_LOG_POLICY)
  try { for (let i = 0; i < fixtures.length; i += 100) db.append(fixtures.slice(i, i + 100)); db.append([foreign]) }
  finally { db.close() }
})

test('real retained Caller evidence supports bounded native filters, expansion, full matching export and focus', async ({ page }) => {
  await page.addInitScript(() => {
    const tasks: number[] = []
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push(entry.duration) }).observe({ type: 'longtask', buffered: true })
    Object.assign(window, { loggingLongTasks: tasks })
  })
  await ready(page)
  await expect(rows(page)).toHaveCount(50)
  await expect(status(page)).toContainText('122 matching retained events')
  await expect(page.locator('#view-logging')).not.toContainText('bob-private-evidence')
  const button = rows(page).filter({ hasText: 'fetch failed' }).first().getByRole('button', { name: 'Toggle diagnostic evidence' })
  await button.focus(); await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  const detail = page.locator('#logging-tbody > .agent-expand-row').first()
  await expect(detail).toContainText('fatal: retained stderr token=[redacted]')
  await expect(detail).toContainText('underlying retained cause')
  await expect(detail).toContainText('Resource measurement time')
  await expect(detail).toContainText('statfs')
  await expect(detail.getByRole('link', { name: 'Open pull request' })).toHaveAttribute('href', 'https://github.com/acme/repo/pull/42')
  await action(page, 'refresh').click()
  await expect(page.locator('#logging-loader')).toBeHidden()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await button.focus();
  // Programmatic refresh keeps the row button focused.
  await page.evaluate(() => (document.querySelector('[data-action="refresh"]') as HTMLButtonElement).click())
  await expect(page.locator('#logging-loader')).toBeHidden()
  await expect(button).toBeFocused()
  await detail.getByRole('button', { name: 'Show incident', exact: true }).click()
  await expect(detail.locator('.logging-related-list li')).toHaveCount(20)
  await detail.getByRole('button', { name: 'Next 20', exact: true }).click()
  await expect(detail.locator('.logging-related-list li')).toHaveCount(20)
  await expect(detail.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled()
  await detail.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(detail.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
  await page.locator('#logging-source').selectOption('caller')
  await expect(status(page)).toContainText('120 matching retained events')
  const downloadEvent = page.waitForEvent('download')
  await action(page, 'export').click()
  const download = await downloadEvent
  const lines = readFileSync((await download.path())!, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  expect(lines[0]).toMatchObject({ type: 'metadata', exported: 120, total: 120, truncated: false })
  expect(new Set(lines.slice(1).map((line) => line.event.id))).toEqual(new Set(fixtures.filter((event) => event.source === 'caller').map((event) => event.id)))
  expect(JSON.stringify(lines)).not.toContain('fixture-secret')
  await page.locator('[data-level="error"]').click()
  await expect(status(page)).toContainText('0 matching retained events')
  await page.locator('[data-level="critical"]').click(); await page.locator('[data-level="warning"]').click()
  await expect(status(page)).toContainText('No severities selected')
  await expect(page.locator('#logging-empty')).toBeVisible()
  const metrics = await page.evaluate(() => ({ rows: document.querySelectorAll('#logging-table tr').length, tasks: (window as unknown as { loggingLongTasks: number[] }).loggingLongTasks, navigation: (window as unknown as { loggingNavigationMs: number }).loggingNavigationMs }))
  expect(metrics.navigation).toBeLessThan(1000)
  expect(metrics.rows).toBeLessThan(200)
  expect(Math.max(0, ...metrics.tasks)).toBeLessThan(350)
})

test('cold links reveal an event outside the first page, widen bounds, persist view and restore saved filters', async ({ page }) => {
  const target = fixtures[0]
  const path = '/?' + new URLSearchParams({ view: 'logging', event: target.id, from: new Date(Date.now() + 3_600_000).toISOString() })
  await ready(page, path)
  await expect(page.locator('#logging-link')).toContainText('widened visibly')
  await expect(page.locator('#logging-link')).toContainText('outside the current page')
  await expect(page.locator('#logging-link')).toContainText(target.callId!)
  await expect(page.locator('#logging-linked-heading')).toBeFocused()
  expect(page.url()).toContain(target.id)
  await page.reload()
  await expect(page.locator('#logging-link')).toContainText('widened visibly')
  await page.getByRole('button', { name: 'Restore saved filters', exact: true }).click()
  await expect(status(page)).toContainText('122 matching retained events')
  await expect(page.locator('#logging-component')).toHaveValue(component)
  await page.reload()
  await expect(page.locator('#view-logging')).toBeVisible()
  await expect(page.locator('#view-logging .view-header')).toBeFocused()
})

test('late older ingestions stay behind an explicit control and pagination retains its snapshot', async ({ page }) => {
  await ready(page)
  await page.clock.install()
  const initial = await rows(page).evaluateAll((items) => items.map((row) => (row as HTMLElement).dataset.id))
  const late = normalize({ id: 'browser-late', time: new Date(Date.now() - 86_400_000).toISOString(), source: 'poise', component, workspace: 'local', level: 'warning', operation: 'late', message: 'late older evidence' })!
  const db = new DiagnosticStore(storePath)
  try { db.append([late]); lateIds.push(late.id) } finally { db.close() }
  await action(page, 'next').click()
  await expect(page.locator('#logging-page')).toContainText('Page 2')
  await page.clock.runFor(15_000)
  await expect(status(page)).toContainText('122 matching retained events')
  await expect(page.locator('#logging-new')).toBeHidden()
  await action(page, 'previous').click()
  expect(await rows(page).evaluateAll((items) => items.map((row) => (row as HTMLElement).dataset.id))).toEqual(initial)
  await page.clock.runFor(15_000)
  await expect(action(page, 'new')).toHaveText('1 new diagnostics')
  expect(await rows(page).evaluateAll((items) => items.map((row) => (row as HTMLElement).dataset.id))).toEqual(initial)
  await action(page, 'new').click()
  await expect(status(page)).toContainText('123 matching retained events')
  let polls = 0
  page.on('request', (request) => { if (new URL(request.url()).searchParams.has('after')) polls++ })
  await page.getByRole('button', { name: 'Current', exact: true }).click()
  await page.clock.runFor(45_000)
  expect(polls).toBe(0)
})

test('custom interval drafts survive refresh, use zoned civil bounds, and reject invalid ranges honestly', async ({ page }) => {
  await ready(page, undefined, 'Europe/Helsinki')
  await page.locator('[data-time="custom"]').click()
  await page.locator('#logging-from').fill('2026-03-29T00:00:00+02:00')
  await page.locator('#logging-to').fill('2026-03-30T00:00:00+03:00')
  await action(page, 'refresh').click()
  await expect(page.locator('#logging-loader')).toBeHidden()
  await expect(page.locator('#logging-from')).toHaveValue('2026-03-29T00:00:00+02:00')
  await expect(page.locator('#logging-to')).toHaveValue('2026-03-30T00:00:00+03:00')
  const response = page.waitForResponse((reply) => reply.url().includes('/api/logging?') && reply.url().includes('2026-03-28'))
  await page.getByRole('button', { name: 'Apply interval' }).click()
  expect((await response).url()).toContain('to=2026-03-29T21%3A00%3A00.000Z')
  await expect(page.locator('#logging-empty')).toBeVisible()
  await page.locator('#logging-from').fill('2026-02-30T00:00:00Z')
  await page.getByRole('button', { name: 'Apply interval' }).click()
  await expect(page.locator('#logging-message')).toContainText('Invalid diagnostic filters')
  await expect(page.locator('#logging-empty')).toBeHidden()
})

test('failed refreshes are stale and lookup failures never become an ordinary empty table', async ({ page }) => {
  await ready(page)
  const saved = await rows(page).count()
  await page.route('**/api/logging?**', (route) => route.fulfill({ status: 503, json: { error: 'logging_unavailable', message: 'Fixture sink unavailable' } }))
  await action(page, 'refresh').click()
  await expect(status(page)).toContainText('Stale results')
  await expect(status(page)).toContainText('Snapshot read')
  await expect(rows(page)).toHaveCount(saved)
  await page.unroute('**/api/logging?**')
  for (const [code, text] of [[404, 'evidence is unavailable'], [410, 'evidence has expired'], [503, 'query service is unavailable']] as const) {
    await page.route('**/api/logging/events/**', (route) => route.fulfill({ status: code, json: { error: 'logging_unavailable', message: 'Fixture evidence state', bounds: { from: null, to: null, retentionAfter: '2026-09-19T00:00:00Z' } } }))
    await page.goto('/?view=logging&event=' + fixtures[0].id)
    await expect(page.locator('#logging-link')).toContainText(text)
    await expect(page.locator('#logging-empty')).toBeHidden()
    await expect(page.locator('#logging-health')).toContainText('Retention boundary:')
    await page.unroute('**/api/logging/events/**')
  }
  await page.goto('/?view=logging&event=invalid')
  await expect(page.locator('#logging-link')).toContainText('link is invalid')
  await expect(page.locator('#logging-empty')).toBeHidden()
})

for (const theme of ['light', 'dark']) test(`uses native table styles and bounded desktop/narrow layout in ${theme}`, async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await ready(page)
  await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
  const native = await rows(page).first().evaluate((row) => ({ font: getComputedStyle(row).fontFamily, size: getComputedStyle(row).fontSize, class: row.className }))
  expect(native.class).toBe('agent-row')
  expect(native.font.length).toBeGreaterThan(0)
  await rows(page).first().getByRole('button', { name: 'Toggle diagnostic evidence' }).click()
  await page.screenshot({ path: info.outputPath(`${theme}-logging-desktop.png`), fullPage: true })
  await page.setViewportSize({ width: 420, height: 820 })
  await page.screenshot({ path: info.outputPath(`${theme}-logging-narrow.png`), fullPage: true })
  const sizes = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, rows: document.querySelectorAll('#logging-table tr').length }))
  expect(sizes.body).toBeLessThanOrEqual(sizes.width + 1)
  expect(sizes.rows).toBeLessThan(200)
  expect(await rows(page).first().evaluate((row) => getComputedStyle(row).fontFamily)).toBe(native.font)
  expect(lateIds.length).toBe(1)
})
