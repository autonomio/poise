import { integrate, MOTION, MOTION_CSS } from '../gateway/src/motion-model.js'
import './motion.css'

export { MOTION } from '../gateway/src/motion-model.js'
export type MotionValues = Record<string, number>
interface MotionOptions {
  from: MotionValues
  to: MotionValues | (() => MotionValues)
  write(values: MotionValues): void
  complete?(): void
  canComplete?(): boolean
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

export function finishMotion(root?: HTMLElement): void {
  // Scroll targets depend on the final geometry of panels and disclosures.
  const ordered = [...moving].sort((a, b) => Number(a.name === 'scroll') - Number(b.name === 'scroll'))
  for (const channel of ordered) {
    if (root && channel.owner !== root && !root.contains(channel.owner)) continue
    if (channel.name === 'scroll' && !channel.owner.getClientRects().length) { cancelMotion(channel.owner, channel.name); continue }
    if (channel.owner.getClientRects().length) target(channel)
    complete(channel)
  }
}

export function onMotionFrame(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }

export function reveal(element: HTMLElement, { distance = MOTION.travel, delay = 0 }: { distance?: number, delay?: number } = {}): void {
  spring(element, 'entry', { from: { progress: 0 }, to: { progress: 1 }, delay,
    write: ({ progress }) => {
      element.dataset.flowEnter = ''
      element.style.opacity = String(bounded(progress))
      element.style.setProperty('--flow-enter-y', `${(1 - progress) * distance}px`)
    }, complete: () => {
      element.style.opacity = ''; element.style.removeProperty('--flow-enter-y')
      delete element.dataset.flowEnter; cancelMotion(element, 'entry')
    } })
}

export function layout<T>(root: HTMLElement, change: () => T, selector = ':scope > *', key: (element: HTMLElement) => string | HTMLElement = element => element): T {
  const before = new Map([...root.querySelectorAll<HTMLElement>(selector)].map(element => [key(element), { element, box: element.getBoundingClientRect() }]))
  const result = change()
  const after = [...root.querySelectorAll<HTMLElement>(selector)]
  // Remove all old layout offsets before measuring any new destination.
  for (const element of after) { element.style.removeProperty('--flow-layout-x'); element.style.removeProperty('--flow-layout-y') }
  for (const element of after) {
    const previous = before.get(key(element))
    if (!previous || !previous.box.width || !previous.box.height) continue
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
}
