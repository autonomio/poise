import { defaultNavigation, getNavigation, NAVIGATION_CHANGED, NAVIGATION_KEY, saveNavigation, VIEW_ITEMS } from './navigation'

export function navigationSection(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'st-tab'
  section.dataset.tab = 'navigation'
  section.hidden = true
  section.innerHTML = `
    <div class="tp-group-label">Shortcuts</div>
    <p class="st-help">Choose where each view appears. Changes are saved in this browser.</p>
    <table class="st-navigation" aria-label="View shortcuts">
      <thead><tr><th scope="col">View</th><th scope="col">Menu</th><th scope="col">Top bar</th></tr></thead>
      <tbody>${VIEW_ITEMS.map(({ key, label }) => `<tr>
        <th scope="row">${label}</th>
        ${(['menu', 'topBar'] as const).map((surface) => `<td><label class="st-navigation-choice"><input type="checkbox" data-view="${key}" data-surface="${surface}" aria-label="${label} in ${surface === 'menu' ? 'menu' : 'top bar'}" /></label></td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>
    <div class="st-row"><button type="button" class="st-clear">Reset navigation</button></div>
    <p class="st-help st-help-error" role="status" hidden></p>`
  const status = section.querySelector<HTMLElement>('[role="status"]')!
  function sync(): void {
    const preferences = getNavigation()
    for (const { key } of VIEW_ITEMS) for (const surface of ['menu', 'topBar'] as const) {
      section.querySelector<HTMLInputElement>(`[data-view="${key}"][data-surface="${surface}"]`)!.checked = preferences[key][surface]
    }
  }
  function save(preferences: ReturnType<typeof getNavigation>): void {
    try {
      saveNavigation(preferences)
      status.hidden = true
    } catch (error) {
      sync()
      status.textContent = `Navigation was not saved: ${error instanceof Error ? error.message : String(error)}`
      status.hidden = false
    }
  }
  section.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return
    const input = event.target
    const view = VIEW_ITEMS.find(({ key }) => key === input.dataset.view)
    const surface = input.dataset.surface
    if (!view || (surface !== 'menu' && surface !== 'topBar')) return
    const preferences = getNavigation()
    preferences[view.key][surface] = input.checked
    save(preferences)
  })
  section.querySelector('button')!.addEventListener('click', () => save(defaultNavigation()))
  window.addEventListener(NAVIGATION_CHANGED, sync)
  window.addEventListener('storage', (event) => { if (event.key === NAVIGATION_KEY || event.key === null) sync() })
  sync()
  return section
}
