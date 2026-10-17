import { expect, test, type Page } from '@playwright/test'
import { BEHAVIORS } from '../../src/behaviors'

async function workspace(page: Page) {
  const reads: URL[] = []
  const state = { fail: false, reads }
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'))
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('poise-view', 'behaviors')
    localStorage.setItem('poise-current-filters', JSON.stringify({ time: 'week', status: 'all' }))
  })
  await page.route(/https:\/\/(?:rsms\.me|fonts\.googleapis\.com|fonts\.gstatic\.com|github\.com)\//, (route) => route.abort())
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/behavior-metrics') {
      state.reads.push(url)
      if (state.fail) return route.fulfill({ status: 502, json: { error: 'Run history unavailable' } })
      const filtered = url.searchParams.has('since')
      return route.fulfill({ json: { error: null, behaviors: Object.fromEntries(BEHAVIORS.map(({ key }) => [key,
        { totalRuns: filtered ? 4 : 120, durationMinutes: filtered ? 8.5 : 240.5, successRate: filtered ? 75 : 95 },
      ])) } })
    }
    if (url.pathname === '/api/behaviors') return route.fulfill({ json: Object.fromEntries(BEHAVIORS.map(({ key }) => [key,
      { owner: 'review-bot', enabled: true, setting: 'p2', reviewers: 1, scratchpad: '', skipRepos: [], repos: [], authors: [], lastTriggered: null },
    ])) })
    if (url.pathname === '/api/settings') return route.fulfill({ json: { org: 'acme', me: 'octocat', timezone: 'Asia/Kolkata', models: {} } })
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { mode: 'local' } })
    if (url.pathname === '/api/claude-auth') return route.fulfill({ json: { status: 'authenticated', loginInProgress: false } })
    if (url.pathname === '/api/notices') return route.fulfill({ json: { enabled: false, notices: [] } })
    if (url.pathname === '/api/agent-logs') return route.fulfill({ json: { logs: [] } })
    return route.fulfill({ json: {} })
  })
  return state
}

test('filters the entire metrics section in the configured timezone without changing settings or Current', async ({ page }) => {
  const state = await workspace(page)
  await page.goto('/')
  const row = page.locator('tr[data-behavior="review-new-prs"]')
  await expect(row.locator('.behavior-metric')).toHaveText(['120', '240.5', '95%'])
  await expect(row.locator('td').first().locator('input')).toBeChecked()
  await expect(page.locator('#behaviors-table th').first()).toHaveText('')
  await expect(page.locator('#behaviors-table th').nth(2)).toHaveText('Status')
  await expect(page.locator('#view-behaviors')).not.toContainText('Behavior settings apply')
  for (const [range, since, until] of [
    ['today', '2026-10-16T18:30:00.000Z', null],
    ['yesterday', '2026-10-15T18:30:00.000Z', '2026-10-16T18:30:00.000Z'],
    ['week', '2026-10-11T18:30:00.000Z', null],
  ]) {
    await page.locator(`#behaviors-time-picker [data-time="${range}"]`).click()
    await expect(row.locator('.behavior-metric')).toHaveText(['4', '8.5', '75%'])
    expect(state.reads.at(-1)?.searchParams.get('since')).toBe(since)
    expect(state.reads.at(-1)?.searchParams.get('until')).toBe(until)
    await expect(row.locator('input')).toBeChecked()
    await expect(page.locator(`#behaviors-time-picker [data-time="${range}"]`)).toHaveAttribute('aria-pressed', 'true')
  }
  await page.locator('#behaviors-time-picker [data-time="all"]').click()
  await expect(row.locator('.behavior-metric')).toHaveText(['120', '240.5', '95%'])
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('poise-current-filters') || '{}').time)).toBe('week')
  state.fail = true
  await page.locator('#behaviors-time-picker [data-time="today"]').click()
  await expect(row.locator('.behavior-metric')).toHaveText(['—', '—', '—'])
  await expect(page.locator('#behavior-metrics-error')).toHaveText('Run history unavailable')
})

test('keeps columns spaced and single-line across desktop and narrow viewports in both themes', async ({ page }, info) => {
  await workspace(page)
  await page.goto('/')
  await expect(page.locator('#behaviors-tbody tr')).toHaveCount(6)
  await expect(page.locator('#behaviors-tbody tr').first().locator('.behavior-metric')).toHaveText(['120', '240.5', '95%'])
  for (const width of [1920, 1600, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await page.locator('#view-behaviors main').evaluate((main) => {
      const table = main.querySelector('table')!
      const reviewers = table.querySelector<HTMLElement>('.col-reviewers')!.getBoundingClientRect()
      const memory = table.querySelector<HTMLElement>('.col-memory')!.getBoundingClientRect()
      return { left: main.getBoundingClientRect().left, width: main.clientWidth, tableWidth: table.clientWidth,
        reviewerGap: memory.left - reviewers.left, pageWidth: document.documentElement.clientWidth,
        cells: [...table.querySelectorAll('tbody tr:first-child td')].map((cell) => cell.getBoundingClientRect().height) }
    })
    expect(geometry.left).toBeCloseTo(24, 0)
    expect(geometry.width).toBeGreaterThan(geometry.pageWidth - 60)
    expect(geometry.reviewerGap).toBeGreaterThanOrEqual(90)
    expect(new Set(geometry.cells).size).toBe(1)
    if (width >= 1600) expect(geometry.tableWidth).toBeLessThanOrEqual(geometry.width)
    await page.screenshot({ path: info.outputPath(`behaviors-${width}-light.png`) })
  }
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: info.outputPath('behaviors-1600-dark.png') })
})
