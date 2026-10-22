// Passage chats open inline under their passage: the thread pushes the text
// below it down without entering the saved document, closed chats show
// margin markers, and chats move to the side pane and back with their draft.
import { expect, test, type Page } from '@playwright/test'
import { workspace } from './fixtures/workspace'
import { installRoutes, installSocket, makeState, session, env, NOW } from './fixtures/chat'
import type { ChatEnvelope, ChatSubject } from '../../server/chat/protocol'
type ChatSocket = Awaited<ReturnType<typeof installSocket>>
type ServerState = ReturnType<typeof makeState>

const VERSION = 'a'.repeat(64)
const AT = '2026-10-21T08:00:00Z'
const TEXT = '# A question\n\nOpening paragraph.\n\nA final thought.'

interface StoredAnnotation {
  id: string
  session_id?: string
  range: { start_line: number, start_offset: number, end_line: number, end_offset: number }
  snippet: string
  comment: string
}

function annotation(overrides: Partial<StoredAnnotation> & { id: string }): StoredAnnotation {
  return {
    range: { start_line: 2, start_offset: 0, end_line: 2, end_offset: 18 },
    snippet: 'Opening paragraph.',
    comment: '',
    created_at: AT,
    updated_at: AT,
    ...overrides,
  } as StoredAnnotation
}

function modelsState() {
  return {
    catalog: { models: [{ identity: 'opus-5-max', selector: 'claude-opus-5', effort: 'max', provider: 'claude' }], review_providers: [], path: '' },
    places: [{ key: 'editor', default: 'opus-5-max' }],
    fixed: [],
    refresh: null,
  }
}

interface Harness {
  state: ServerState
  sock: ChatSocket
  saves: string[]
  annotationSaves: StoredAnnotation[][]
}

async function editor(page: Page, stored: StoredAnnotation[] = [], content = TEXT): Promise<Harness> {
  const state = makeState([], {})
  state.models = modelsState()
  // The socket route must exist before navigation: registered after, the
  // WebSocket connects to the real server instead of the fixture.
  const sock = await installSocket(page, state)
  await workspace(page)
  // REST routes resolve last-registered-wins, so these go after the
  // workspace catch-all.
  await installRoutes(page, state)
  const saves: string[] = []
  const annotationSaves: StoredAnnotation[][] = []
  let annotations: unknown[] = stored
  let body = content
  await page.route('**/api/editor/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/editor/docs') return route.fulfill({ json: { docs: [{ slug: 'draft', title: 'A question', updated_at: AT, size: body.length }] } })
    if (path === '/api/editor/doc/draft') {
      if (request.method() === 'PUT' || request.method() === 'POST') {
        body = String((request.postDataJSON() as { content: unknown }).content)
        saves.push(body)
      }
      return route.fulfill({ json: { slug: 'draft', title: 'A question', content: body, updated_at: AT, version: VERSION } })
    }
    if (path.endsWith('/annotations')) {
      if (request.method() === 'PUT' || request.method() === 'POST') {
        annotations = (request.postDataJSON() as { annotations: unknown[] }).annotations
        annotationSaves.push(annotations as StoredAnnotation[])
      }
      return route.fulfill({ json: { annotations, version: VERSION } })
    }
    if (path.endsWith('/google/sync')) return route.fulfill({ json: { publications: [], version: VERSION } })
    if (path.endsWith('/reviews') || path.endsWith('/reviews/sync')) {
      return route.fulfill({ json: { reviews: [], checkedAt: null, active: false, stale: false, problems: [] } })
    }
    return route.fulfill({ json: {} })
  })
  await page.getByRole('button', { name: 'Editor', exact: true }).click()
  await expect(page.locator('#editor-doc')).toContainText('Opening paragraph.')
  return { state, sock, saves, annotationSaves }
}

const thread = (page: Page) => page.locator('.editor-inline-thread')
const threadInput = (page: Page) => thread(page).locator('.chat-input')
const threadTranscript = (page: Page) => thread(page).locator('.chat-surface-transcript')
const markerCount = (page: Page) => page.locator('.editor-thread-marker')
const marker = (page: Page, name: string) => page.locator('.editor-inline-threads').getByRole('button', { name, exact: true })
const pane = (page: Page) => page.locator('#chat-side-pane')

async function openThreadForMark(page: Page, id: string): Promise<void> {
  await page.locator(`.annotation-mark[data-ann-id="${id}"]`).first().click()
  await expect(thread(page)).toBeVisible()
}

async function sendThreadMessage(page: Page, sock: ChatSocket, text: string): Promise<string> {
  const before = sock.framesOf('prompt').length
  await threadInput(page).fill(text)
  await threadInput(page).press('Enter')
  await expect.poll(() => sock.framesOf('prompt').length).toBe(before + 1)
  return (sock.framesOf('prompt')[before].command as { sessionId: string }).sessionId
}

async function finishReply(sock: ChatSocket, id: string, text: string, reply: string, turnId = 't1'): Promise<ChatEnvelope[]> {
  await sock.subscribed(id)
  return [
    sock.push(id, { type: 'turn.started', turnId, prompt: { text, attachments: [], mentions: [] } }),
    sock.push(id, { type: 'text.delta', turnId, messageId: `${turnId}-reply`, delta: reply }),
    sock.push(id, { type: 'turn.finished', turnId, stopReason: 'end_turn' }),
  ]
}

async function lineBox(page: Page, needle: string) {
  const line = page.locator('#editor-doc .editor-line', { hasText: needle }).first()
  await expect(line).toBeVisible()
  return line.boundingBox()
}

test('opens a passage chat inline under its passage and pushes the text below it down', async ({ page }) => {
  await editor(page, [annotation({ id: 'ann-1', comment: 'Why this?' })])
  const nextBefore = await lineBox(page, 'A final thought.')
  await openThreadForMark(page, 'ann-1')
  // The thread is in the layer beside the doc, never one of its lines.
  await expect(page.locator('#editor-doc .editor-inline-thread')).toHaveCount(0)
  await expect(page.locator('.editor-page > .editor-inline-threads > .editor-inline-thread')).toHaveCount(1)
  const geometry = async () => {
    const box = await thread(page).boundingBox()
    const line = await lineBox(page, 'Opening paragraph.')
    const next = await lineBox(page, 'A final thought.')
    const padding = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#editor-doc .editor-line')]
      const found = lines.find((el) => el.textContent!.includes('Opening paragraph.')) as HTMLElement
      return Number.parseFloat(found.style.paddingBottom || '0')
    })
    return { box: box!, line: line!, next: next!, padding }
  }
  // Within 16 px of the bottom of the passage's last source line.
  await expect.poll(async () => {
    const { box, line, padding } = await geometry()
    return Math.abs(box.y - (line.y + line.height - padding))
  }).toBeLessThanOrEqual(16)
  // The next line moved down by at least the thread's height.
  await expect.poll(async () => {
    const { box, next } = await geometry()
    return next.y - nextBefore!.y - box.height
  }).toBeGreaterThanOrEqual(0)
  // The note is today's comment, saved on input.
  await expect(thread(page).locator('.editor-annotation-text')).toHaveValue('Why this?')
})

test('keeps the saved document text unchanged while a thread is open', async ({ page }) => {
  const { saves } = await editor(page, [annotation({ id: 'ann-1', comment: 'Why this?' })])
  const before = await page.locator('#editor-doc').innerText()
  await openThreadForMark(page, 'ann-1')
  expect(await page.locator('#editor-doc').innerText()).toBe(before)
  // Enter in the passage's last line splits the text, not the thread. The
  // annotation mark covers the passage text, so focus lands on the title
  // line and the caret moves to the passage end directly instead of by click.
  await page.locator('#editor-doc .editor-line').first().click()
  await page.evaluate(() => {
    const line = [...document.querySelectorAll('#editor-doc .editor-line')].find((el) => el.textContent!.includes('Opening paragraph.'))!
    const range = document.createRange()
    range.selectNodeContents(line)
    range.collapse(false)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.press('Enter')
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0]).toBe(TEXT.replace('Opening paragraph.\n', 'Opening paragraph.\n\n'))
  expect(saves[0]).not.toContain('Move to the side pane')
  expect(saves[0]).not.toContain('Why this?')
})

test('keeps the thread under its passage while the person types above it and when the page narrows', async ({ page }) => {
  await editor(page, [annotation({ id: 'ann-1' })])
  await openThreadForMark(page, 'ann-1')
  const distance = async () => {
    const box = await thread(page).boundingBox()
    const line = await lineBox(page, 'Opening paragraph.')
    const padding = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#editor-doc .editor-line')]
      const found = lines.find((el) => el.textContent!.includes('Opening paragraph.')) as HTMLElement
      return Number.parseFloat(found.style.paddingBottom || '0')
    })
    return Math.abs(box!.y - (line!.y + line!.height - padding))
  }
  const first = page.locator('#editor-doc .editor-line').first()
  await first.click()
  await page.keyboard.press('Home')
  await page.keyboard.type('Intro words. ')
  await expect.poll(distance).toBeLessThanOrEqual(16)
  await page.setViewportSize({ width: 700, height: 900 })
  await expect.poll(distance).toBeLessThanOrEqual(16)
})

test('proposes an edit elsewhere in the document from a passage chat and applies it', async ({ page }) => {
  const { sock, saves } = await editor(page, [annotation({ id: 'ann-1' })])
  await openThreadForMark(page, 'ann-1')
  const id = await sendThreadMessage(page, sock, 'Sharpen the ending')
  const reply = JSON.stringify({ chat: 'One edit.', edits: [{ description: 'close', old: 'A final thought.', new: 'A final thought, revised.' }] })
  await finishReply(sock, id, 'Sharpen the ending', reply)
  const card = threadTranscript(page).locator('.chat-edit-card').first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect.poll(() => sock.framesOf('edit.decide').length).toBe(1)
  expect(sock.framesOf('edit.decide')[0].command).toMatchObject({ type: 'edit.decide', sessionId: id, index: 0, decision: 'applied' })
  expect(saves[0]).toContain('A final thought, revised.')
})

test('shows Working, Needs you and New reply in the margin for a closed passage chat', async ({ page }) => {
  const { state, sock } = await editor(page, [annotation({ id: 'ann-1' })])
  await openThreadForMark(page, 'ann-1')
  const id = await sendThreadMessage(page, sock, 'What does it say?')
  await thread(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(thread(page)).toBeHidden()
  await expect(marker(page, 'Working')).toBeVisible()
  const created = state.sessions.find((s) => s.id === id)!
  await sock.subscribed(id)
  sock.push(id, { type: 'session.updated', session: { ...created, status: 'idle' } })
  sock.push(id, { type: 'turn.finished', turnId: 't1', stopReason: 'end_turn' })
  await expect(marker(page, 'New reply')).toBeVisible()
  sock.push(id, { type: 'permission.requested', id: 'p1', turnId: 't1', title: 'Run tests?', options: [{ id: 'yes', name: 'Yes', kind: 'allow_once' }] })
  await expect(marker(page, 'Needs you')).toBeVisible()
  // Opening the thread clears it.
  await marker(page, 'Needs you').click()
  await expect(thread(page)).toBeVisible()
  await expect(markerCount(page)).toHaveCount(0)
})

test('moves a passage chat to the side pane and back with its draft', async ({ page }) => {
  await editor(page, [annotation({ id: 'ann-1' })])
  await openThreadForMark(page, 'ann-1')
  await threadInput(page).fill('An unsent thought')
  await thread(page).getByRole('button', { name: 'Move to the side pane', exact: true }).click()
  await expect(thread(page)).toBeHidden()
  await expect(pane(page)).toBeVisible()
  await expect(pane(page).locator('.chat-input')).toHaveValue('An unsent thought')
  await pane(page).locator('.chat-input').fill('An unsent thought, edited')
  await pane(page).getByRole('button', { name: 'Back to the passage', exact: true }).click()
  await expect(pane(page)).not.toHaveClass(/open/)
  await expect(thread(page)).toBeVisible()
  await expect(threadInput(page)).toHaveValue('An unsent thought, edited')
})

test('closes on Escape and returns the caret to the passage', async ({ page }) => {
  await editor(page, [annotation({ id: 'ann-1' })])
  await openThreadForMark(page, 'ann-1')
  await expect(thread(page).locator('.editor-annotation-text')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(thread(page)).toBeHidden()
  const caret = await page.evaluate(() => {
    const sel = window.getSelection()!
    if (!sel.rangeCount || !sel.isCollapsed) return null
    const node = sel.anchorNode!
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as unknown as HTMLElement)
    const line = element.closest('.editor-line')!
    return { text: line.textContent, offset: sel.anchorOffset, atEnd: sel.anchorOffset === (node.textContent || '').length }
  })
  expect(caret?.text).toContain('Opening paragraph.')
  expect(caret?.atEnd).toBe(true)
})

test('keeps a passage chat whose text was edited away and marks it Passage changed', async ({ page }) => {
  const { state, sock } = await editor(page, [annotation({ id: 'ann-1' })])
  await openThreadForMark(page, 'ann-1')
  const id = await sendThreadMessage(page, sock, 'What does it say?')
  const envelopes = await finishReply(sock, id, 'What does it say?', 'It says hello.')
  state.history[id] = envelopes
  const created = state.sessions.find((s) => s.id === id)!
  sock.push(id, { type: 'session.updated', session: { ...created, status: 'idle' } })
  await thread(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(thread(page)).toBeHidden()
  await expect(markerCount(page)).toHaveCount(0)
  const line = page.locator('#editor-doc .editor-line', { hasText: 'Opening paragraph.' }).first()
  await line.fill('Something entirely different.')
  await expect(marker(page, 'Passage changed')).toBeVisible()
  // The chat is still there, at the stored line.
  await marker(page, 'Passage changed').click()
  await expect(thread(page)).toBeVisible()
  await expect(threadTranscript(page)).toContainText('It says hello.')
})

test("shows an annotation's earlier conversation and continues it", async ({ page }) => {
  const { state, sock } = await editor(page, [annotation({ id: 'ann-1', session_id: 'ann-qncjuig3' })])
  const subject: ChatSubject = { surface: 'editor-passage', key: 'draft:ann-1', label: 'Opening paragraph.' }
  const seeded = session({ id: 's-passage', subject, importedFrom: 'ann-qncjuig3', status: 'idle' })
  state.sessions.unshift(seeded)
  state.history['s-passage'] = [env('s-passage', 1, {
    type: 'history.imported', legacyId: 'ann-qncjuig3',
    turns: [{ prompt: 'Earlier passage question', reply: 'Earlier passage answer', at: NOW, status: 'completed' }], omitted: 0,
  })]
  await openThreadForMark(page, 'ann-1')
  await expect(threadTranscript(page)).toContainText('Earlier conversation')
  await expect(threadTranscript(page)).toContainText('Earlier passage question')
  await sendThreadMessage(page, sock, 'Follow-up')
  expect(sock.framesOf('prompt')[0].command).toMatchObject({ type: 'prompt', sessionId: 's-passage', text: 'Follow-up' })
})
