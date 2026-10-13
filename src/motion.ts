import { integrate, MOTION, MOTION_CSS } from '../gateway/src/motion-model.js'

export { MOTION } from '../gateway/src/motion-model.js'
export type MotionValues = Record<string, number>
interface MotionOptions {
  from: MotionValues
  to: MotionValues | (() => MotionValues)
  write(values: MotionValues): void
  complete?(): void
  canComplete?(): boolean
  valid?(): boolean
  delay?: number
  rebase?: boolean
}
interface Channel {
  owner: HTMLElement
  name: string
  value: MotionValues
  velocity: MotionValues
  range: MotionValues
  target: MotionValues
  options: MotionOptions
  active: boolean
  generation: number
  start: number
}

const channels = new WeakMap<HTMLElement, Map<string, Channel>>()
const moving = new Set<Channel>()
const listeners = new Set<() => void>()
const disclosurePadding = new WeakMap<HTMLElement, { top: number, bottom: number }>()
const nativeDetails = new WeakSet<HTMLDetailsElement>()
let preference: MediaQueryList | undefined
let frame = 0, previousTime = 0
const bounded = (value: number) => Math.max(0, Math.min(1, value))

export function reducedMotion(): boolean { return (preference ?? window.matchMedia('(prefers-reduced-motion: reduce)')).matches }
export function motionActive(): boolean { return moving.size > 0 }
export function motionValue(owner: HTMLElement, name: string): MotionValues | null {
  const channel = channels.get(owner)?.get(name)
  return channel?.active ? { ...channel.value } : null
}

function mark(owner: HTMLElement): void {
  owner.toggleAttribute('data-motion-running', [...(channels.get(owner)?.values() ?? [])].some(channel => channel.active))
}

function target(channel: Channel): void {
  const next = typeof channel.options.to === 'function' ? channel.options.to() : channel.options.to
  for (const key of Object.keys(next)) {
    if (!Number.isFinite(next[key]) || !Number.isFinite(channel.value[key])) throw new Error(`Motion received non-finite ${channel.name}.${key}.`)
    channel.range[key] = Math.max(channel.range[key] ?? 1, Math.abs(next[key] - channel.value[key]), 1)
  }
  channel.target = { ...next }
}

function complete(channel: Channel): void {
  const generation = channel.generation
  channel.active = false
  moving.delete(channel)
  channel.value = { ...channel.target }
  for (const key of Object.keys(channel.velocity)) channel.velocity[key] = 0
  channel.options.write({ ...channel.value })
  mark(channel.owner)
  if (channel.generation === generation) channel.options.complete?.()
}

function tick(now: number): void {
  const elapsed = Math.min(Math.max(0, (now - previousTime) / 1000), .032)
  previousTime = now
  for (const channel of [...moving]) {
    if (!channel.active) continue
    if (channel.options.valid && !channel.options.valid()) { cancelMotion(channel.owner, channel.name); continue }
    if (!channel.owner.isConnected || !channel.owner.getClientRects().length) {
      if (channel.name === 'scroll') cancelMotion(channel.owner, channel.name)
      else complete(channel)
      continue
    }
    if (now < channel.start) continue
    target(channel)
    let resting = true
    for (const key of Object.keys(channel.target)) {
      const next = integrate(channel.value[key], channel.velocity[key], channel.target[key], elapsed)
      channel.value[key] = next.position; channel.velocity[key] = next.velocity
      if (Math.abs(next.position - channel.target[key]) > channel.range[key] * .0008 || Math.abs(next.velocity) > channel.range[key] * .008) resting = false
    }
    if (resting && (channel.options.canComplete?.() ?? true)) complete(channel)
    else channel.options.write({ ...channel.value })
  }
  for (const listener of listeners) listener()
  frame = moving.size ? requestAnimationFrame(tick) : 0
}

export function spring(owner: HTMLElement, name: string, options: MotionOptions): void {
  let own = channels.get(owner)
  if (!own) { own = new Map(); channels.set(owner, own) }
  let channel = own.get(name)
  if (!channel) {
    channel = { owner, name, value: { ...options.from }, velocity: {}, range: {}, target: {}, options, active: false, generation: 0, start: 0 }
    own.set(name, channel)
  } else if (!channel.active) { channel.value = { ...options.from }; channel.velocity = {} }
  else if (options.rebase) channel.value = { ...options.from }
  channel.options = options
  channel.generation++
  target(channel)
  for (const key of Object.keys(channel.target)) channel.velocity[key] ??= 0
  channel.start = performance.now() + (options.delay ?? 0)
  channel.active = true
  if (reducedMotion()) { complete(channel); return }
  moving.add(channel)
  mark(owner)
  options.write({ ...channel.value })
  if (!frame) { previousTime = performance.now(); frame = requestAnimationFrame(tick) }
}

export function cancelMotion(owner: HTMLElement, name: string): void {
  const channel = channels.get(owner)?.get(name)
  if (!channel) return
  channel.active = false; channel.generation++
  moving.delete(channel)
  channels.get(owner)!.delete(name)
  mark(owner)
}

export function finishMotion(root?: HTMLElement, cancelScroll = document.hidden): void {
  // Scroll targets depend on the final geometry of panels and disclosures.
  const ordered = [...moving].sort((a, b) => Number(a.name === 'scroll') - Number(b.name === 'scroll') || (a.owner.contains(b.owner) ? 1 : b.owner.contains(a.owner) ? -1 : 0))
  for (const channel of ordered) {
    if (!channel.active) continue
    if (root && channel.owner !== root && !root.contains(channel.owner)) continue
    if (channel.options.valid && !channel.options.valid()) { cancelMotion(channel.owner, channel.name); continue }
    if (channel.name === 'scroll' && (cancelScroll || !channel.owner.getClientRects().length)) { cancelMotion(channel.owner, channel.name); continue }
    if (channel.owner.getClientRects().length) target(channel)
    complete(channel)
  }
}

export function onMotionFrame(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }

export function reveal(element: HTMLElement, { distance = MOTION.travel, delay = 0 }: { distance?: number, delay?: number } = {}): void {
  spring(element, 'entry', { from: { opacity: 0, y: distance }, to: { opacity: 1, y: 0 }, delay,
    write: ({ opacity, y }) => {
      element.style.opacity = String(bounded(opacity))
      if (distance) { element.dataset.flowEnter = ''; element.style.setProperty('--flow-enter-y', `${y}px`) }
    }, complete: () => {
      element.style.opacity = ''; element.style.removeProperty('--flow-enter-y')
      delete element.dataset.flowEnter; cancelMotion(element, 'entry')
    } })
}

export function layout<T>(root: HTMLElement, change: () => T, selector = ':scope > *', key: (element: HTMLElement) => string | HTMLElement = element => element): T {
  const active = document.activeElement
  const before = new Map([...root.querySelectorAll<HTMLElement>(selector)].map(element => [key(element), { element, box: element.getBoundingClientRect() }]))
  const result = change()
  if (active instanceof HTMLElement && active.isConnected && root.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true })
  const after = [...root.querySelectorAll<HTMLElement>(selector)]
  // Remove all old layout offsets before measuring any new destination.
  for (const element of after) { element.style.removeProperty('--flow-layout-x'); element.style.removeProperty('--flow-layout-y') }
  for (const element of after) {
    const previous = before.get(key(element))
    if (!previous) { reveal(element, { distance: MOTION.information }); continue }
    if (!previous.box.width || !previous.box.height) continue
    if (previous.element !== element) throw new Error('Motion layout requires retained semantic actor identity.')
    const next = element.getBoundingClientRect()
    if (!next.width || !next.height) continue
    const x = previous.box.left - next.left, y = previous.box.top - next.top
    if (Math.abs(x) < .5 && Math.abs(y) < .5 && !motionValue(element, 'layout')) continue
    spring(element, 'layout', { from: { x, y }, to: { x: 0, y: 0 }, rebase: true,
      write: ({ x, y }) => {
        element.dataset.flowLayout = ''
        element.style.setProperty('--flow-layout-x', `${x}px`); element.style.setProperty('--flow-layout-y', `${y}px`)
      }, complete: () => {
        delete element.dataset.flowLayout
        element.style.removeProperty('--flow-layout-x'); element.style.removeProperty('--flow-layout-y')
        cancelMotion(element, 'layout')
      } })
  }
  return result
}

/** Logical removal is immediate; the inert visual has no IDs or live controls. */
export function retire(element: HTMLElement): void {
  const box = element.getBoundingClientRect()
  const opacity = Number(getComputedStyle(element).opacity)
  if (!box.width || !box.height || reducedMotion()) { finishMotion(element); element.remove(); return }
  let ghost = element.cloneNode(true) as HTMLElement
  if (element instanceof HTMLTableRowElement) {
    const row = ghost as HTMLTableRowElement
    row.style.opacity = '1'
    ;[...row.cells].forEach((cell, index) => { cell.style.width = `${element.cells[index].getBoundingClientRect().width}px` })
    ghost = element.closest('table')!.cloneNode(false) as HTMLTableElement
    const body = document.createElement('tbody'); body.append(row); ghost.append(body)
  }
  ghost.inert = true
  ghost.setAttribute('aria-hidden', 'true')
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
    node.removeAttribute('id'); node.removeAttribute('data-motion-running')
    node.removeAttribute('data-flow-layout'); node.removeAttribute('data-flow-enter')
  }
  ghost.dataset.flowRetiring = ''
  Object.assign(ghost.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: getComputedStyle(element).zIndex === 'auto' ? '132' : getComputedStyle(element).zIndex, translate: 'none', transform: 'none' })
  finishMotion(element, true)
  element.remove()
  document.body.appendChild(ghost)
  spring(ghost, 'retirement', { from: { opacity, y: 0 }, to: { opacity: 0, y: -MOTION.information },
    write: ({ opacity, y }) => { ghost.style.opacity = String(bounded(opacity)); ghost.style.translate = `0 ${y}px` },
    complete: () => { ghost.remove(); cancelMotion(ghost, 'retirement') } })
}

/** Fixed measurements never shrink the live document's native scroll bounds. */
export function intrinsicHeight(element: HTMLElement, padding?: { top: number, bottom: number }): number {
  const clone = element.cloneNode(true) as HTMLElement
  clone.dataset.flowMeasuring = ''
  clone.inert = true
  clone.hidden = false
  Object.assign(clone.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', width: `${element.getBoundingClientRect().width}px`, height: 'auto', translate: 'none', transform: 'none' })
  if (padding) { clone.style.paddingTop = `${padding.top}px`; clone.style.paddingBottom = `${padding.bottom}px` }
  element.parentElement!.appendChild(clone)
  try { return clone.getBoundingClientRect().height } finally { clone.remove() }
}

/** An intrinsic block keeps its logical hidden state while its old words retire. */
export function disclosure(element: HTMLElement, opened: boolean, done?: () => void, presentedHeight = element.getBoundingClientRect().height): void {
  const height = presentedHeight
  const computed = getComputedStyle(element)
  const display = computed.display
  const opacity = Number(computed.opacity)
  const padding = disclosurePadding.get(element) ?? { top: parseFloat(computed.paddingTop), bottom: parseFloat(computed.paddingBottom) }
  disclosurePadding.set(element, padding)
  element.hidden = !opened
  element.inert = !opened
  element.style.setProperty('--flow-display', opened ? getComputedStyle(element).display : display)
  element.dataset.flowDisclosure = ''
  if (!opened) element.dataset.flowRetained = ''
  else delete element.dataset.flowRetained
  element.style.overflow = 'hidden'
  spring(element, 'disclosure', { from: { height, opacity: opened && !height ? 0 : opacity, top: opened && !height ? 0 : parseFloat(computed.paddingTop), bottom: opened && !height ? 0 : parseFloat(computed.paddingBottom) },
    to: () => ({ height: opened ? intrinsicHeight(element, padding) : 0, opacity: opened ? 1 : 0, top: opened ? padding.top : 0, bottom: opened ? padding.bottom : 0 }),
    write: ({ height, opacity, top, bottom }) => { element.style.height = `${Math.max(0, height)}px`; element.style.opacity = String(bounded(opacity)); element.style.paddingTop = `${Math.max(0, top)}px`; element.style.paddingBottom = `${Math.max(0, bottom)}px` },
    complete: () => {
      element.style.height = ''; element.style.opacity = ''; element.style.overflow = ''
      element.style.paddingTop = ''; element.style.paddingBottom = ''
      element.style.removeProperty('--flow-display')
      delete element.dataset.flowDisclosure; delete element.dataset.flowRetained
      cancelMotion(element, 'disclosure')
      done?.()
    } })
}

/** Changed information settles in place; typing and streaming never call this. */
export function resizeContent<T>(element: HTMLElement, change: () => T): T {
  const height = element.getBoundingClientRect().height
  const result = change()
  if (!height || !element.getClientRects().length) return result
  element.style.overflow = 'hidden'
  spring(element, 'content-size', { from: { height }, to: () => ({ height: intrinsicHeight(element) }),
    write: ({ height }) => { element.style.height = `${Math.max(0, height)}px` },
    complete: () => { element.style.height = ''; element.style.overflow = ''; cancelMotion(element, 'content-size') } })
  return result
}

/** Fixed owners opt in explicitly; descendants and text mutations are ignored. */
export function watchPanel(element: HTMLElement, opened: () => boolean, slide: -1 | 0 | 1 = 0): void {
  let previous = opened()
  let display = getComputedStyle(element).display
  new MutationObserver(() => {
    const next = opened()
    if (previous === next) return
    previous = next
    element.inert = !next
    if (next) {
      delete element.dataset.flowRetained; delete element.dataset.flowPanelRetained
      element.style.removeProperty('--flow-display')
      display = getComputedStyle(element).display
    } else {
      element.style.setProperty('--flow-display', display)
      element.dataset.flowRetained = ''; element.dataset.flowPanelRetained = ''
    }
    spring(element, 'panel', { from: { progress: next ? 0 : 1 }, to: { progress: next ? 1 : 0 },
      write: ({ progress }) => {
        element.style.opacity = String(bounded(progress))
        if (slide) element.style.transform = `translateX(${slide * (1 - progress) * 100}%)`
        else element.style.translate = `0 ${(1 - progress) * MOTION.travel}px`
      }, complete: () => {
        element.style.opacity = ''; element.style.translate = ''
        if (slide) element.style.transform = ''
        delete element.dataset.flowRetained; delete element.dataset.flowPanelRetained
        element.style.removeProperty('--flow-display'); cancelMotion(element, 'panel')
      } })
  }).observe(element, { attributes: true, attributeFilter: ['class', 'hidden'] })
}

/** Bounded scrolling follows live geometry and yields immediately to direct input. */
export function scroll(element: HTMLElement, destination: () => number, actor?: HTMLElement): void {
  if (document.hidden || !element.getClientRects().length || actor && (!actor.isConnected || !actor.getClientRects().length)) { cancelMotion(element, 'scroll'); return }
  spring(element, 'scroll', { from: { y: element.scrollTop }, to: () => ({ y: Math.max(0, Math.min(element.scrollHeight - element.clientHeight, destination())) }),
    valid: () => !actor || actor.isConnected && !!actor.getClientRects().length,
    write: ({ y }) => { element.scrollTop = y }, complete: () => cancelMotion(element, 'scroll') })
}

export function scrollToActor(actor: HTMLElement, block: 'center' | 'nearest' = 'nearest'): void {
  let container = actor.parentElement
  while (container && container !== document.body && !/(auto|scroll)/.test(getComputedStyle(container).overflowY)) container = container.parentElement
  const owner = container && container !== document.body ? container : document.documentElement
  scroll(owner, () => {
    const box = actor.getBoundingClientRect(), parent = owner === document.documentElement ? { top: 0, height: innerHeight, bottom: innerHeight } : owner.getBoundingClientRect()
    if (block === 'center') return owner.scrollTop + box.top - parent.top - (parent.height - box.height) / 2
    return box.top < parent.top ? owner.scrollTop + box.top - parent.top : box.bottom > parent.bottom ? owner.scrollTop + box.bottom - parent.bottom : owner.scrollTop
  }, actor)
}

export function initMotion(): void {
  if (preference) return
  preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  for (const declaration of MOTION_CSS.split(';').filter(Boolean)) {
    const at = declaration.indexOf(':')
    document.documentElement.style.setProperty(declaration.slice(0, at), declaration.slice(at + 1))
  }
  preference.addEventListener('change', () => { if (preference?.matches) finishMotion() })
  window.addEventListener('resize', () => finishMotion())
  window.addEventListener('beforeprint', () => finishMotion())
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishMotion() })
  window.addEventListener('pagehide', () => finishMotion(undefined, true))
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) document.addEventListener(event, () => {
    for (const channel of [...moving]) if (channel.name === 'scroll') cancelMotion(channel.owner, 'scroll')
  }, { capture: true, passive: true })
  document.addEventListener('click', event => {
    const summary = (event.target as Element).closest('summary')
    const details = summary?.parentElement
    if (!(details instanceof HTMLDetailsElement) || summary !== details.querySelector(':scope > summary') || event.defaultPrevented) return
    if ((event.target as Element).closest('a, button, input, select, textarea')) return
    const bodies = [...details.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== summary
      && !child.matches('datalist, script, style, template, input[type="hidden"], [hidden]:not([data-flow-retained])'))
    if (!bodies.length) return
    if (!nativeDetails.has(details)) {
      nativeDetails.add(details)
      details.addEventListener('toggle', () => {
        if (details.hasAttribute('data-flow-details')) return
        for (const body of bodies) { body.hidden = false; body.inert = !details.open }
      })
    }
    event.preventDefault()
    const opened = !details.open
    const heights = bodies.map(body => body.getBoundingClientRect().height)
    details.dataset.flowDetails = ''
    details.open = opened
    let remaining = bodies.length
    bodies.forEach((body, index) => disclosure(body, opened, () => { body.hidden = false; body.inert = !details.open; if (!--remaining) delete details.dataset.flowDetails }, heights[index]))
  })
}
