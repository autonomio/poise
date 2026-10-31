// The entry bootstrap: it finishes an Extensions OAuth return, chooses the
// interface, installs the tab-wide watchers, and loads one interface. Only
// this module and the chosen interface load; classic's entry is `./classic`,
// the new interface `./ui/app`. All of this runs in the module, not in an
// inline script: production's content security policy is `script-src 'self'`.
import { INTERFACE_STORAGE_KEY, resolveInterface } from './interface-choice'
import { installSelfUpdateWatch } from './self-update-watch'
import { watchForUpdates } from './updating'
import { watchForSignOut } from './signed-out'

/** Rollback for every browser: a one-line commit setting this to true loads
 *  classic whatever a browser chose. Reverting the flip alone would leave
 *  browsers that chose the new interface on it. */
const FORCE_CLASSIC_INTERFACE = false

async function boot(): Promise<void> {
  // 1. An Extensions sign-in comes back to /extensions/oauth?code&state.
  // Finish it before anything else reads that query: Google's return looks
  // the same. Only this address pays for the import.
  if (location.pathname === '/extensions/oauth') {
    const { finishExtensionSignIn } = await import('./views/extensions-view')
    await finishExtensionSignIn()
  }
  // 2. The recovery address (`?interface=classic`) saves the classic choice;
  // the override and the stored choice decide otherwise. Classic is the
  // default until the flip.
  const query = new URLSearchParams(location.search)
  let stored: string | null = null
  try {
    stored = localStorage.getItem(INTERFACE_STORAGE_KEY)
  } catch {
    stored = null
  }
  const decision = resolveInterface({ forceClassic: FORCE_CLASSIC_INTERFACE, queryValue: query.get('interface'), storedValue: stored })
  if (decision.persistChoice !== null) {
    try {
      localStorage.setItem(INTERFACE_STORAGE_KEY, decision.persistChoice)
    } catch {
      // Nowhere to save: this load still uses the choice.
    }
  }
  document.documentElement.dataset.interface = decision.choice
  // 3. The tab-wide watchers, before an interface makes its first request: a
  // promoted build, an answer the gateway marks as updating, and a sign-in
  // in front of Poise that has ended.
  installSelfUpdateWatch()
  watchForUpdates()
  watchForSignOut()
  // 4. One interface. A failed load falls back to classic and says so,
  // naming the failure.
  try {
    if (decision.choice === 'new') {
      const ui = await import('./ui/app')
      await ui.mount()
    } else {
      await import('./classic')
    }
  } catch (error) {
    if (decision.choice !== 'new') throw error
    await import('./classic')
    const { noticeFeed } = await import('./notices')
    noticeFeed.reportLocalNotices('interface-fallback', [{
      key: 'interface-fallback',
      kind: 'action_failed',
      title: 'The new interface could not load',
      body: `Classic loaded instead: ${error instanceof Error ? error.message : String(error)}`,
    }])
  }
}

void boot()
