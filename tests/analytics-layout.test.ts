import { describe, expect, it } from 'vitest'
import { cardPositions, reconcileCardOrder } from '../src/analytics-layout'

describe('analytics card order', () => {
  it('retains saved identities, removes duplicates and missing cards, and appends new cards', () => {
    expect(reconcileCardOrder(['quota:user', 'merged', 'merged', 'retired'], ['opened', 'merged', 'quota:user', 'review']))
      .toEqual(['quota:user', 'merged', 'opened', 'review'])
  })
  it('packs mixed widths and height families without overlapping or changing reading order', () => {
    const positions = cardPositions([
      { id: 'wide', span: 10, height: 352 },
      { id: 'compact', span: 4, height: 272 },
      { id: 'regular', span: 5, height: 352 },
      { id: 'next', span: 5, height: 272 },
    ], 988)
    expect([...positions.keys()]).toEqual(['wide', 'compact', 'regular', 'next'])
    expect(positions.get('wide')).toEqual({ x: 0, y: 0, width: 488, height: 352 })
    expect(positions.get('compact')).toEqual({ x: 500, y: 0, width: 188, height: 272 })
    expect(positions.get('regular')).toEqual({ x: 700, y: 0, width: 238, height: 352 })
    expect(positions.get('next')).toEqual({ x: 0, y: 364, width: 238, height: 272 })
  })
  it('places full-width cards in separate rows at narrow widths', () => {
    expect([...cardPositions([{ id: 'first', span: 20, height: 272 }, { id: 'second', span: 20, height: 352 }], 320).values()])
      .toEqual([{ x: 0, y: 0, width: 320, height: 272 }, { x: 0, y: 284, width: 320, height: 352 }])
  })
})
