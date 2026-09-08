import { describe, it, expect } from 'bun:test'
import { minoritySign } from './minority-sign'

/**
 * This exists because the first version of the rule was a constant — "tint the positives" —
 * and it shipped fifteen ordinary credit-card charges in green before a screenshot caught it.
 * The sign that dominates is a property of the statement in front of you, not of the app.
 */
describe('minoritySign', () => {
  it('marks the refunds on a chequing statement', () => {
    // Mostly money going out, one refund coming back.
    expect(minoritySign([-84.2, -12.75, -249.99, -38.4, -9.99, 412.1])).toBe(1)
  })

  it('marks the refunds on a card statement, where the signs are flipped', () => {
    // The same statement imported as liabilities: a charge increases what you owe, so it
    // reads positive, and the refund is the negative one. A hard-coded rule gets this
    // exactly backwards, which is how every charge on the screen turned green.
    expect(minoritySign([84.2, 12.75, 249.99, 38.4, 9.99, -412.1])).toBe(-1)
  })

  it('tints nothing when the list is all one direction', () => {
    // No minority to mark. Colouring the only sign present is colouring every row.
    expect(minoritySign([-10, -20, -30])).toBe(0)
    expect(minoritySign([10, 20, 30])).toBe(0)
  })

  it('tints nothing when the split is near even', () => {
    // A "minority" that is nearly half the rows is not one, and marking it would just be
    // colouring half the column.
    expect(minoritySign([1, 2, 3, -1, -2, -3])).toBe(0)
    expect(minoritySign([1, 2, 3, 4, -1, -2, -3])).toBe(0)
  })

  it('takes two thirds as the line', () => {
    expect(minoritySign([-1, -2, -3, -4, -5, -6, 1, 2, 3])).toBe(1)
  })

  it('ignores zeroes and unparseable amounts rather than counting them as a side', () => {
    expect(minoritySign([-10, -20, -30, 0, Number.NaN, 5])).toBe(1)
  })

  it('handles an empty statement', () => {
    expect(minoritySign([])).toBe(0)
  })
})
