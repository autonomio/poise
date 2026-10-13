import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { workspace } from './fixtures/workspace'
import { settled } from './fixtures/motion'

declare global { interface Window { Motion: typeof import('../../src/motion'); Patch: typeof import('../../src/dom-patch') } }

async function runtime(page: Page): Promise<void> {
  await workspace(page)
  await settled(page)
  for (const [path, globalName] of [['src/motion.ts', 'Motion'], ['src/dom-patch.ts', 'Patch']]) {
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
