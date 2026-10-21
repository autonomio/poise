import { expect, test } from '@playwright/test'
import { workspace } from './fixtures/workspace'
import { settled } from './fixtures/motion'

test('draws a multi-line annotation and opens its note from its mark', async ({ page }) => {
  await workspace(page); await settled(page)
  const version = 'e'.repeat(64)
  const at = '2026-10-21T08:00:00Z'
  // A selection across lines stores its snippet with the lines joined by '\n'.
  const annotation = { id: 'ann-1', session_id: 'ann-1', range: { start_line: 0, start_offset: 6, end_line: 1, end_offset: 6 }, snippet: 'line\nSecond', comment: 'Spans two lines', created_at: at, updated_at: at }
  await page.route('**/api/editor/docs', route => route.fulfill({ json: { docs: [{ slug: 'notes', title: 'Notes', updatedAt: at, size: 22 }] } }))
  await page.route('**/api/editor/doc/notes', route => route.fulfill({ json: { slug: 'notes', content: 'First line\nSecond line', version } }))
  await page.route('**/api/editor/doc/notes/annotations', route => route.fulfill({ json: { annotations: [annotation], version } }))
  await page.getByRole('button', { name: 'Editor', exact: true }).click()
  const marks = page.locator('.annotation-mark')
  await expect(marks.first()).toBeVisible()
  // One underline on each of the two lines the annotation covers.
  expect(new Set(await marks.evaluateAll(els => els.map(el => (el as HTMLElement).style.top))).size).toBe(2)
  await marks.first().click()
  await expect(page.locator('.editor-annotation-text')).toHaveValue('Spans two lines')
})
