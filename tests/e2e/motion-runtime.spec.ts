import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { workspace } from './fixtures/workspace'
import { settled } from './fixtures/motion'

declare global { interface Window { Motion: typeof import('../../src/motion'); Patch: typeof import('../../src/dom-patch'); Builder: typeof import('../../src/views/jev-builder'); Results: typeof import('../../src/views/jev-results') } }

async function runtime(page: Page): Promise<void> {
  await workspace(page)
  await settled(page)
  for (const [path, globalName] of [['src/motion.ts', 'Motion'], ['src/dom-patch.ts', 'Patch'], ['src/views/jev-builder.ts', 'Builder'], ['src/views/jev-results.ts', 'Results']]) {
    const bundle = await build({ entryPoints: [path], bundle: true, write: false, format: 'iife', globalName })
    const url = `/__motion/${globalName}.js`
    await page.route(`**${url}`, route => route.fulfill({ body: bundle.outputFiles[0].text, contentType: 'application/javascript' }))
    await page.addScriptTag({ url })
  }
  await page.evaluate(() => window.Motion.initMotion())
}

test('motion retains momentum on reversal and settles only the latest completion', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(async () => {
    const actor = document.createElement('div'); actor.style.cssText = 'width:40px;height:40px'; document.body.append(actor)
    const completions: string[] = []
    const write = ({ x }: Record<string, number>) => { actor.style.translate = `${x}px 0` }
    window.Motion.spring(actor, 'x', { from: { x: 0 }, to: { x: 100 }, write, complete: () => completions.push('old') })
    await new Promise(resolve => setTimeout(resolve, 80))
    const before = actor.getBoundingClientRect().x
    window.Motion.spring(actor, 'x', { from: { x: 0 }, to: { x: 0 }, write, complete: () => completions.push('new') })
    const retargeted = actor.getBoundingClientRect().x
    await new Promise(resolve => requestAnimationFrame(resolve))
    const next = actor.getBoundingClientRect().x
    await new Promise<void>(resolve => { const frame = () => actor.hasAttribute('data-motion-running') ? requestAnimationFrame(frame) : resolve(); requestAnimationFrame(frame) })
    return { before, retargeted, next, completions, translate: actor.style.translate }
  })
  expect(result.retargeted).toBe(result.before)
  expect(result.next).toBeGreaterThan(result.retargeted)
  expect(result.completions).toEqual(['new'])
  expect(result.translate).toBe('0px')
})

test('a status patch cannot reset an entering actor or replace its focused button', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(() => {
    const list = document.createElement('div'); list.innerHTML = '<div style="height:40px;width:200px"><button data-action="delete">Delete</button></div>'; document.body.append(list)
    const row = list.firstElementChild as HTMLElement
    const button = row.querySelector('button')!; button.focus()
    window.Motion.reveal(row)
    const box = row.getBoundingClientRect()
    const before = { x: box.x, y: box.y, opacity: Number(getComputedStyle(row).opacity) }
    window.Patch.patchContent(list, '<div style="height:40px;width:200px"><button data-action="delete">Confirm</button></div>')
    const afterBox = row.getBoundingClientRect()
    return { connected: row.isConnected, sameButton: row.querySelector('button') === button, focused: document.activeElement === button, before, after: { x: afterBox.x, y: afterBox.y, opacity: Number(getComputedStyle(row).opacity) } }
  })
  expect(result).toMatchObject({ connected: true, sameButton: true, focused: true })
  expect(result.after).toEqual(result.before)
})

test('a fade-only entrance cannot change fixed descendant coordinates', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(() => {
    const parent = document.createElement('section'); parent.style.cssText = 'height:100px;width:200px;margin-top:100px'
    const popup = document.createElement('div'); popup.style.cssText = 'position:fixed;top:10px;left:10px;width:40px;height:40px'; parent.append(popup); document.body.append(parent)
    const before = popup.getBoundingClientRect()
    window.Motion.reveal(parent, { distance: 0 })
    const after = popup.getBoundingClientRect()
    return { before: { x: before.x, y: before.y }, after: { x: after.x, y: after.y } }
  })
  expect(result.after).toEqual(result.before)
})

test('hiding a scrolling document cancels navigation at its presented reading position', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(async () => {
    const owner = document.createElement('div'); owner.style.cssText = 'height:100px;width:200px;overflow:auto'; owner.innerHTML = '<div style="height:1000px">Reading</div>'; document.body.append(owner)
    owner.scrollTop = 50
    window.Motion.scroll(owner, () => 800)
    await new Promise(resolve => setTimeout(resolve, 80))
    const before = owner.scrollTop
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise(resolve => setTimeout(resolve, 80))
    return { before, after: owner.scrollTop, running: owner.hasAttribute('data-motion-running') }
  })
  expect(result.before).toBeGreaterThan(50)
  expect(result.before).toBeLessThan(800)
  expect(result.after).toBe(result.before)
  expect(result.running).toBe(false)
})

test('late navigation cannot move a hidden reduced-motion document', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await runtime(page)
  const result = await page.evaluate(() => {
    const owner = document.createElement('div'); owner.style.cssText = 'height:100px;width:200px;overflow:auto'; owner.innerHTML = '<div style="height:1000px">Reading</div>'; document.body.append(owner)
    owner.scrollTop = 50
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    window.Motion.scroll(owner, () => 800)
    return { y: owner.scrollTop, running: owner.hasAttribute('data-motion-running') }
  })
  expect(result).toEqual({ y: 50, running: false })
})

test('retirement keeps the presented opacity and print releases the inert visual', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(() => {
    const actor = document.createElement('div'); actor.style.cssText = 'opacity:.35;width:120px;height:40px'; actor.textContent = 'Departing words'; document.body.append(actor)
    window.Motion.retire(actor)
    const ghost = document.querySelector<HTMLElement>('[data-flow-retiring]')!
    const result = { removed: !actor.isConnected, opacity: Number(getComputedStyle(ghost).opacity), inert: ghost.inert }
    window.dispatchEvent(new Event('beforeprint'))
    return { ...result, ghostRemoved: !ghost.isConnected }
  })
  expect(result).toEqual({ removed: true, opacity: .35, inert: true, ghostRemoved: true })
})

test('guided scrolling stops when its destination actor departs', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(async () => {
    const owner = document.createElement('div'); owner.style.cssText = 'height:100px;width:200px;overflow:auto'
    owner.innerHTML = '<div style="height:1000px"><div style="height:40px;margin-top:600px">Destination</div></div>'
    document.body.append(owner)
    const actor = owner.firstElementChild!.firstElementChild as HTMLElement
    window.Motion.scrollToActor(actor, 'center')
    await new Promise(resolve => setTimeout(resolve, 80))
    const before = owner.scrollTop
    actor.remove()
    await new Promise(resolve => setTimeout(resolve, 80))
    return { before, after: owner.scrollTop, running: owner.hasAttribute('data-motion-running') }
  })
  expect(result.before).toBeGreaterThan(0)
  expect(result.after).toBe(result.before)
  expect(result.running).toBe(false)
})

test('retained popup controls become inert at logical close', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(async () => {
    const panel = document.createElement('aside'); panel.hidden = true; panel.style.cssText = 'width:200px;height:100px'
    panel.innerHTML = '<button>Retiring control</button>'; document.body.append(panel)
    window.Motion.watchPanel(panel, () => !panel.hidden)
    panel.hidden = false
    await new Promise(resolve => setTimeout(resolve, 80))
    panel.hidden = true
    await new Promise<void>(resolve => queueMicrotask(resolve))
    panel.querySelector('button')!.focus()
    return { inert: panel.inert, presented: !!panel.getClientRects().length, focused: panel.contains(document.activeElement) }
  })
  expect(result).toEqual({ inert: true, presented: true, focused: false })
})

test('table retirement applies actor opacity once', async ({ page }) => {
  await runtime(page)
  const opacity = await page.evaluate(() => {
    const table = document.createElement('table'); table.innerHTML = '<tbody><tr style="opacity:.35"><td>Departing row</td></tr></tbody>'; document.body.append(table)
    window.Motion.retire(table.querySelector('tr')!)
    const ghost = document.querySelector<HTMLElement>('[data-flow-retiring]')!
    return Number(getComputedStyle(ghost).opacity) * Number(getComputedStyle(ghost.querySelector('tr')!).opacity)
  })
  expect(opacity).toBe(.35)
})

test('question editors survive temporarily duplicated editable answer IDs', async ({ page }) => {
  await runtime(page)
  await page.evaluate(() => {
    const builder = window.Builder.createJevBuilder({ models: async () => [], changed: () => undefined, evaluate: () => undefined, preview: () => undefined, example: () => undefined, template: () => undefined })
    builder.set(builder.draft)
    document.body.append(builder.el)
  })
  await page.locator('.jev-builder [data-add="choice"]').click()
  const editors = page.locator('.jev-question')
  await expect(editors).toHaveCount(2)
  const ids = page.getByRole('textbox', { name: 'Answer ID', exact: true })
  const original = await ids.first().inputValue()
  await ids.nth(1).fill(original)
  await page.locator('.jev-builder [data-format="text"]').click()
  await expect(editors).toHaveCount(2)
  await expect(ids.nth(0)).toHaveValue(original)
  await expect(ids.nth(1)).toHaveValue(original)
  await ids.nth(1).fill('corrected')
  await page.locator('.jev-builder [data-format="text"]').click()
  await expect(editors).toHaveCount(2)
  await expect(ids.nth(1)).toHaveValue('corrected')
})

test('native request disclosure keeps its model suggestions hidden during opening', async ({ page }) => {
  await runtime(page)
  await page.evaluate(() => {
    const builder = window.Builder.createJevBuilder({ models: async () => [{ name: 'jev-latest', description: 'Stable model' }], changed: () => undefined, evaluate: () => undefined, preview: () => undefined, example: () => undefined, template: () => undefined })
    builder.set(builder.draft); document.body.append(builder.el)
  })
  await page.locator('.jev-advanced > summary').click()
  expect(await page.locator('.jev-advanced datalist').evaluate(async element => {
    let visible = false
    await new Promise<void>(resolve => {
      const start = performance.now()
      const frame = () => { visible ||= !!element.getClientRects().length; if (performance.now() - start < 800) requestAnimationFrame(frame); else resolve() }
      requestAnimationFrame(frame)
    })
    return visible
  })).toBe(false)
  await expect(page.getByRole('textbox', { name: 'JEV model', exact: true })).toBeVisible()
})

test('reordered results retain each question’s native distribution state', async ({ page }) => {
  await runtime(page)
  const result = await page.evaluate(() => {
    const answer: import('../../src/jev-types').JevAnswer = { type: 'choice', choice: 'Yes', probabilities: { Yes: .75, No: .25 }, confidence: .5 }
    const run: import('../../src/jev-types').JevRun = { id: 'fixture', sessionId: 'fixture', status: 'completed', startedAt: '2026-10-13T10:00:00Z',
      request: { model: 'jev-latest', state: 'Browser fixture', questions: { First: { type: 'choice', instructions: 'First question' }, Second: { type: 'choice', instructions: 'Second question' } } },
      result: { model: 'jev-latest', answers: { First: answer, Second: answer }, usage: { input_tokens: 0, output_tokens: 0 } } }
    const container = document.createElement('section'); container.innerHTML = window.Results.renderJevRun(run); document.body.append(container)
    const first = [...container.querySelectorAll('article')].find(card => card.querySelector('strong')?.textContent === 'First')!
    first.querySelector('details')!.open = false
    run.result!.answers = { Second: answer, First: answer }
    window.Patch.patchContent(container, window.Results.renderJevRun(run))
    return [...container.querySelectorAll('article')].map(card => ({ question: card.querySelector('strong')!.textContent, open: card.querySelector('details')!.open, retained: card === first }))
  })
  expect(result).toEqual([{ question: 'Second', open: true, retained: false }, { question: 'First', open: false, retained: true }])
})
