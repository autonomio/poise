import { describe, expect, it } from 'vitest'
import { parseResourceOwnership, resourceOwnershipReleased, resourceReleaseProven } from '../server/behavior-resource-receipt'

const ROOT = { path: '/isolated/call', state: 'reclaimed', device: '1', inode: '2', parent_device: '1', parent_inode: '3', reclaimed_at: 10 }
const OWNED = { version: 1, roots: [ROOT], errors: [] }

describe('native resource receipt boundary', () => {
  it('requires positive reclamation rather than a terminal phase or release timestamp alone', () => {
    const stamp = { resources_settled_at: new Date().toISOString() }
    expect(resourceReleaseProven(stamp, true)).toBe(false)
    expect(resourceReleaseProven({ ...stamp, resource_ownership: OWNED }, true)).toBe(true)
    for (const change of [{ roots: [{ ...ROOT, state: 'allocated', reclaimed_at: undefined }] }, { process_pending: true },
      { errors: [{ cause: 'resources_unknown', path: ROOT.path, at: 1 }] }]) {
      expect(resourceReleaseProven({ ...stamp, resource_ownership: { ...OWNED, ...change } }, true)).toBe(false)
    }
  })

  it('retains the original cleanup failure and requires a covering recovery receipt', () => {
    const failed = { ...OWNED, errors: [{ cause: 'deletion denied', path: ROOT.path, at: 5 }] }
    expect(resourceOwnershipReleased(parseResourceOwnership(failed))).toBe(false)
    const recovered = { ...failed, roots: [{ ...ROOT, recovered_at: 10 }] }
    expect(resourceOwnershipReleased(parseResourceOwnership(recovered))).toBe(true)
    expect(recovered.errors).toEqual(failed.errors)
    expect(resourceOwnershipReleased(parseResourceOwnership({ ...recovered, errors: [{ ...failed.errors[0], at: 11 }] }))).toBe(false)
  })

  it('preserves full-width kernel inode identities without JavaScript numeric rounding', () => {
    const value = { ...OWNED, roots: [{ ...ROOT, inode: '18446744073709551615' }] }
    expect(parseResourceOwnership(value).roots[0].inode).toBe('18446744073709551615')
  })

  it.each([{ roots: [ROOT, ROOT] }, { roots: [{ ...ROOT, inode: -1 }] },
    { roots: [{ ...ROOT, reclaimed_at: null }] }, { roots: [{ ...ROOT, recovered_at: 11 }] },
    { errors: [{ cause: 'denied', path: '/foreign', at: 1 }] }, { process_pending: 'false' }, { recovered: true }])(
    'rejects malformed or unbound proof: %j', change => {
      expect(() => parseResourceOwnership({ ...OWNED, ...change })).toThrow(/resource/)
    })
})
