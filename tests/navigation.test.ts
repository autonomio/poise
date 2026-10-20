import { describe, expect, it } from 'vitest'
import { defaultNavigation, parseNavigation } from '../src/navigation'

describe('navigation preferences', () => {
  it('preserves the existing menu and top bar by default', () => {
    const preferences = defaultNavigation()
    expect(Object.entries(preferences).filter(([, placement]) => placement.menu).map(([key]) => key)).toEqual(['analytics', 'logging'])
    expect(Object.entries(preferences).filter(([, placement]) => placement.topBar).map(([key]) => key)).toEqual(['current', 'swarm', 'chat', 'main', 'behaviors', 'snippets', 'editor'])
  })

  it('accepts both, neither and either surface, keeping defaults for newly introduced views', () => {
    expect(parseNavigation({ current: { menu: true, topBar: true }, chat: { menu: false, topBar: false }, analytics: { menu: false, topBar: true } })).toEqual({
      ...defaultNavigation(), current: { menu: true, topBar: true }, chat: { menu: false, topBar: false }, analytics: { menu: false, topBar: true },
    })
  })

  it('rejects invalid saved state with a recovery destination', () => {
    for (const value of [null, [], 'current', { current: null }, { current: { menu: 'true', topBar: true } }, { current: { menu: false } }]) {
      expect(() => parseNavigation(value)).toThrow('Settings → Navigation')
    }
  })
})
