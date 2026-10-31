import { describe, expect, it } from 'vitest'
import { resolveInterface } from '../src/interface-choice'

describe('resolveInterface', () => {
  it('defaults to classic when nothing is stored', () => {
    expect(resolveInterface({ forceClassic: false, queryValue: null, storedValue: null }))
      .toEqual({ choice: 'classic', persistChoice: null })
  })

  it('loads the stored new interface without persisting', () => {
    expect(resolveInterface({ forceClassic: false, queryValue: null, storedValue: 'new' }))
      .toEqual({ choice: 'new', persistChoice: null })
  })

  it('treats an unknown stored value as classic', () => {
    expect(resolveInterface({ forceClassic: false, queryValue: null, storedValue: 'v2' }))
      .toEqual({ choice: 'classic', persistChoice: null })
  })

  it('ignores an unknown query value', () => {
    expect(resolveInterface({ forceClassic: false, queryValue: 'new', storedValue: 'classic' }))
      .toEqual({ choice: 'classic', persistChoice: null })
  })

  it('saves the classic choice on the recovery address', () => {
    expect(resolveInterface({ forceClassic: false, queryValue: 'classic', storedValue: 'new' }))
      .toEqual({ choice: 'classic', persistChoice: 'classic' })
  })

  it('loads classic under the override without touching storage', () => {
    expect(resolveInterface({ forceClassic: true, queryValue: null, storedValue: 'new' }))
      .toEqual({ choice: 'classic', persistChoice: null })
  })
})
