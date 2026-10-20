import { expect, test, type Page } from '@playwright/test'
import { workspace } from './fixtures/workspace'
const VERSION = 'a'.repeat(64), REMOTE = 'b'.repeat(64), TEXT = '# Draft\n\nThe local paragraph.\n'
const accounts = { configured: true, clientId: 'poise.apps.googleusercontent.com', origin: 'http://127.0.0.1:5566', accounts: [{ id: 'one', email: 'one@example.test', connected: true }, { id: 'two', email: 'two@example.test', connected: true }] }
const publication = { accountId: 'one', fileId: 'file-one', title: 'Draft', url: 'https://docs.google.com/document/d/file-one/edit', sourceSha: VERSION, remoteSha: REMOTE, email: 'one@example.test', connected: true, remoteChanged: true, localChanged: true, comments: [{ id: 'c1', author: 'Reviewer', body: 'Please clarify.', quote: 'The local paragraph.', resolved: false, start: 9, end: 29 }] }
async function setup(page: Page) {
  await workspace(page)
  let content = TEXT
  const actions: Array<{ path: string, body: Record<string, unknown> }> = []
  await page.route('**/api/google/accounts', route => route.fulfill({ json: accounts }))
  await page.route('**/api/editor/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    if (method === 'POST') actions.push({ path, body: route.request().postDataJSON() as Record<string, unknown> })
    if (path === '/api/editor/docs') return route.fulfill({ json: { docs: [{ slug: 'google-draft', title: 'Draft', updated_at: '2026-10-20T08:00:00Z', size: content.length }] } })
    if (path === '/api/editor/doc/google-draft') return route.fulfill({ json: { slug: 'google-draft', content, version: VERSION } })
    if (path.endsWith('/annotations')) return route.fulfill({ json: { annotations: [], version: VERSION } })
    if (path.endsWith('/reviews') || path.endsWith('/reviews/sync')) return route.fulfill({ json: { reviews: [], checkedAt: null, active: false, stale: false, problems: [] } })
    if (path.endsWith('/publishing')) return route.fulfill({ json: { title: 'Draft', slug: 'draft', today: '2026-10-20', publications: [] } })
    if (path.endsWith('/google') || path.endsWith('/google/sync') || path.endsWith('/google/publish')) return route.fulfill({ json: { version: VERSION, publications: [publication] } })
    if (path.endsWith('/google/review')) return route.fulfill({ json: { localText: content, remoteText: '# Draft\n\nThe Google paragraph.\n', localVersion: VERSION, remoteSha: REMOTE, comments: publication.comments } })
    if (path.endsWith('/google/import')) { content = '# Draft\n\nThe Google paragraph.\n'; return route.fulfill({ json: { ok: true, content, version: VERSION } }) }
    return route.fulfill({ json: {} })
  })
  await page.getByRole('button', { name: 'Editor', exact: true }).click()
  await expect(page.locator('#editor-doc')).toContainText('The local paragraph.')
  return actions
}
test('publishes the open document through the selected Google account', async ({ page }) => {
  const actions = await setup(page)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Publish', exact: true })
  await dialog.getByLabel('Google publishing account').selectOption('two')
  await dialog.getByRole('button', { name: 'Publish to Google', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Published.')
  expect(actions.find(action => action.path.endsWith('/google/publish'))?.body).toEqual({ accountId: 'two', localVersion: VERSION })
})
test('shows native comments, reviews incoming changes and imports only after explicit acceptance', async ({ page }) => {
  const actions = await setup(page)
  const google = page.locator('.google-documents')
  await google.locator('summary').click()
  await expect(google).toContainText('Please clarify.')
  expect(actions.some(action => action.path.endsWith('/google/import'))).toBe(false)
  await google.getByRole('button', { name: 'Review Google changes', exact: true }).click()
  await expect(google.locator('.google-local')).toContainText('The local paragraph.')
  await expect(google.locator('.google-remote')).toContainText('The Google paragraph.')
  expect(actions.some(action => action.path.endsWith('/google/import'))).toBe(false)
  await google.getByRole('button', { name: 'Keep Poise draft', exact: true }).click()
  await expect(page.locator('#editor-doc')).toContainText('The local paragraph.')
  await google.getByRole('button', { name: 'Review Google changes', exact: true }).click()
  await google.getByRole('button', { name: 'Import Google version', exact: true }).click()
  await expect(page.locator('#editor-doc')).toContainText('The Google paragraph.')
  expect(actions.find(action => action.path.endsWith('/google/import'))?.body).toEqual({ accountId: 'one', localVersion: VERSION, remoteSha: REMOTE })
  expect(actions.some(action => action.path.endsWith('/google/publish'))).toBe(false)
})

test('requires review before explicitly publishing the Poise version over Google changes', async ({ page }) => {
  const actions = await setup(page), google = page.locator('.google-documents')
  await google.locator('summary').click()
  await google.getByRole('button', { name: 'Review Google changes', exact: true }).click()
  await expect(google.locator('.google-remote')).toContainText('The Google paragraph.')
  await google.getByRole('button', { name: 'Publish Poise version instead', exact: true }).click()
  await expect(google.locator('.google-change-review')).toHaveCount(0)
  expect(actions.find(action => action.path.endsWith('/google/publish'))?.body).toEqual({ accountId: 'one', localVersion: VERSION, reviewedRemoteSha: REMOTE })
  await expect(page.locator('#editor-doc')).toContainText('The local paragraph.')
})
test('lists multiple Google connections and disconnects only the chosen account', async ({ page }) => {
  await workspace(page)
  await page.route('**/api/google/accounts', route => route.fulfill({ json: accounts }))
  let disconnected: unknown
  await page.route('**/api/google/disconnect', route => {
    disconnected = route.request().postDataJSON()
    return route.fulfill({ json: { ...accounts, accounts: [{ ...accounts.accounts[0], connected: false }, accounts.accounts[1]] } })
  })
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.locator('#menu-popover').getByRole('button', { name: 'Accounts', exact: true }).click()
  const google = page.locator('.st-google-accounts')
  await expect(google).toContainText('one@example.test · Connected')
  await expect(google).toContainText('two@example.test · Connected')
  await google.getByRole('button', { name: 'Disconnect', exact: true }).first().click()
  await expect(google).toContainText('one@example.test · Disconnected')
  await expect(google).toContainText('two@example.test · Connected')
  expect(disconnected).toEqual({ accountId: 'one' })
})
test('retains the Poise draft when Google changes after review', async ({ page }) => {
  await setup(page)
  await page.route('**/api/editor/doc/google-draft/google/import', route => route.fulfill({ status: 409, json: { error: 'Google changed after the review opened. Review the latest version.' } }))
  const google = page.locator('.google-documents')
  await google.locator('summary').click()
  await google.getByRole('button', { name: 'Review Google changes', exact: true }).click()
  await google.getByRole('button', { name: 'Import Google version', exact: true }).click()
  await expect(google.getByRole('alert')).toContainText('Google changed after the review opened.')
  await expect(page.locator('#editor-doc')).toContainText('The local paragraph.')
  await expect(page.locator('#editor-doc')).toHaveAttribute('contenteditable', 'true')
})
