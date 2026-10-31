// Which interface the bootstrap loads. Pure: the bootstrap passes what it
// reads (the override, the address, the stored choice), so the matrix is
// unit-tested without a DOM.

export type InterfaceChoice = 'classic' | 'new'

/** Per-browser interface choice. Classic is the default until the flip (#556). */
export const INTERFACE_STORAGE_KEY = 'poise-interface'

/** The only `?interface=` value the bootstrap honors: the recovery address. */
export const INTERFACE_RECOVERY_VALUE = 'classic'

export interface InterfaceInputs {
  /** The bootstrap's one-line override: true loads classic whatever a browser chose. */
  forceClassic: boolean
  /** Raw `interface` query value, when the address carries one. */
  queryValue: string | null
  /** Raw stored choice, when this browser chose before. */
  storedValue: string | null
}

export interface InterfaceDecision {
  choice: InterfaceChoice
  /** Persist when set: the recovery address saves the classic choice. */
  persistChoice: InterfaceChoice | null
}

export function resolveInterface({ forceClassic, queryValue, storedValue }: InterfaceInputs): InterfaceDecision {
  if (forceClassic || queryValue === INTERFACE_RECOVERY_VALUE) {
    return { choice: 'classic', persistChoice: queryValue === INTERFACE_RECOVERY_VALUE ? 'classic' : null }
  }
  return { choice: storedValue === 'new' ? 'new' : 'classic', persistChoice: null }
}
