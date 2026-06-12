/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { leafName, suggestAccountId, weightsToPct, pctToVector } from './fish-pie-categories'
import type { Account } from './api'

const acct = (id: string, path: string): Account => ({ id, path }) as Account

describe('leafName', () => {
  it('returns the last colon-delimited segment', () => {
    expect(leafName('expenses:food:dining')).toBe('dining')
    expect(leafName('food')).toBe('food')
    expect(leafName('')).toBe('')
  })
})

describe('suggestAccountId', () => {
  const accounts = [acct('a1', 'expenses:Food'), acct('a2', 'expenses:groceries'), acct('a3', 'assets:cash')]

  it('matches a category to an account by leaf name, case-insensitively', () => {
    expect(suggestAccountId('food', accounts)).toBe('a1')
    expect(suggestAccountId('  GROCERIES ', accounts)).toBe('a2')
  })

  it('returns null when nothing matches or the name is blank', () => {
    expect(suggestAccountId('housing', accounts)).toBeNull()
    expect(suggestAccountId('   ', accounts)).toBeNull()
  })
})

describe('weightsToPct', () => {
  it('computes the first member percentage from a complete vector', () => {
    const weights = [
      { userId: 'u1', weight: 60 },
      { userId: 'u2', weight: 40 },
    ]
    expect(weightsToPct(weights, 'u1', 'u2')).toBe(60)
    expect(weightsToPct(weights, 'u2', 'u1')).toBe(40)
  })

  it('rounds to the nearest whole percent', () => {
    const weights = [
      { userId: 'u1', weight: 1 },
      { userId: 'u2', weight: 2 },
    ]
    expect(weightsToPct(weights, 'u1', 'u2')).toBe(33)
  })

  it('returns null when the vector is empty or missing a member', () => {
    expect(weightsToPct([], 'u1', 'u2')).toBeNull()
    expect(weightsToPct([{ userId: 'u1', weight: 60 }], 'u1', 'u2')).toBeNull()
  })
})

describe('pctToVector', () => {
  it('builds a complete two-member vector summing to 100', () => {
    expect(pctToVector(60, 'u1', 'u2')).toEqual([
      { userId: 'u1', weight: 60 },
      { userId: 'u2', weight: 40 },
    ])
  })

  it('clamps each side to at least 1', () => {
    expect(pctToVector(0, 'u1', 'u2')).toEqual([
      { userId: 'u1', weight: 1 },
      { userId: 'u2', weight: 99 },
    ])
    expect(pctToVector(100, 'u1', 'u2')).toEqual([
      { userId: 'u1', weight: 99 },
      { userId: 'u2', weight: 1 },
    ])
  })
})
