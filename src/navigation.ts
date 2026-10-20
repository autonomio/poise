import { noticeFeed } from './notices'

export const NAVIGATION_KEY = 'poise-navigation'
export const NAVIGATION_CHANGED = 'poise:navigation-changed'
export const VIEW_ITEMS = [
  { key: 'current', label: 'Current' },
  { key: 'swarm', label: 'Swarm' },
  { key: 'chat', label: 'Chat' },
  { key: 'main', label: 'Archive' },
  { key: 'behaviors', label: 'Behaviors' },
  { key: 'snippets', label: 'Snippets' },
  { key: 'editor', label: 'Editor' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'logging', label: 'Logging' },
] as const
export type ViewName = typeof VIEW_ITEMS[number]['key']
export type NavigationPlacement = { menu: boolean, topBar: boolean }
export type NavigationPreferences = Record<ViewName, NavigationPlacement>

export function defaultNavigation(): NavigationPreferences {
  return Object.fromEntries(VIEW_ITEMS.map(({ key }) => [key, {
    menu: key === 'analytics' || key === 'logging',
    topBar: key !== 'analytics' && key !== 'logging',
  }])) as NavigationPreferences
}

export function parseNavigation(value: unknown): NavigationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved navigation must be an object. Reset it in Settings → Navigation.')
  const saved = value as Record<string, unknown>
  const preferences = defaultNavigation()
  for (const { key } of VIEW_ITEMS) {
    if (!(key in saved)) continue // New views retain their default placement.
    const placement = saved[key]
    if (!placement || typeof placement !== 'object' || !('menu' in placement) || !('topBar' in placement)
      || typeof placement.menu !== 'boolean' || typeof placement.topBar !== 'boolean') {
      throw new Error(`Saved navigation for ${key} is invalid. Reset it in Settings → Navigation.`)
    }
    preferences[key] = { menu: placement.menu, topBar: placement.topBar }
  }
  return preferences
}

export function getNavigation(): NavigationPreferences {
  try {
    const saved = localStorage.getItem(NAVIGATION_KEY)
    const preferences = saved === null ? defaultNavigation() : parseNavigation(JSON.parse(saved))
    noticeFeed.reportReadErrors('navigation', [])
    return preferences
  } catch (error) {
    noticeFeed.reportReadErrors('navigation', [{ key: 'navigation', title: 'Navigation preferences could not be read', body: `${error instanceof Error ? error.message : String(error)} Showing the default layout.` }])
    return defaultNavigation()
  }
}

export function saveNavigation(preferences: NavigationPreferences): void {
  localStorage.setItem(NAVIGATION_KEY, JSON.stringify(parseNavigation(preferences)))
  window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED))
}
