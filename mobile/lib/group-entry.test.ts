/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import type { ExpenseGroup, GroupCategory, GroupMember } from './api'
import {
  activeCategories,
  defaultPayerId,
  memberSharePct,
  payerDefaultAccountId,
  resolveMyUserId,
} from './group-entry'

function member(over: Partial<GroupMember> & { userId: string }): GroupMember {
  return {
    id: `m-${over.userId}`,
    groupId: 'g1',
    shareWeight: 1,
    defaultExpenseAccountId: null,
    defaultPaymentAccountId: null,
    joinedAt: '2026-01-01T00:00:00Z',
    userName: over.userId,
    userEmail: `${over.userId}@x.test`,
    ...over,
  }
}

function category(over: Partial<GroupCategory> & { id: string }): GroupCategory {
  return {
    groupId: 'g1',
    name: over.id,
    sortOrder: 0,
    archivedAt: null,
    myMapping: null,
    weights: [],
    ...over,
  }
}

function group(over: Partial<ExpenseGroup>): ExpenseGroup {
  return {
    id: 'g1',
    name: 'Group',
    defaultCurrency: 'CAD',
    createdBy: 'a',
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    members: [],
    categories: [],
    ...over,
  }
}

describe('activeCategories', () => {
  it('drops archived and sorts by sortOrder', () => {
    const g = group({
      categories: [
        category({ id: 'c', sortOrder: 2 }),
        category({ id: 'a', sortOrder: 0 }),
        category({ id: 'gone', sortOrder: 1, archivedAt: '2026-02-01T00:00:00Z' }),
        category({ id: 'b', sortOrder: 1 }),
      ],
    })
    expect(activeCategories(g).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns empty for a group with no categories', () => {
    expect(activeCategories(group({}))).toEqual([])
  })
})

describe('memberSharePct', () => {
  it('splits two equal members 50/50', () => {
    const g = group({ members: [member({ userId: 'a' }), member({ userId: 'b' })] })
    expect(memberSharePct(g, 'a')).toBe(50)
    expect(memberSharePct(g, 'b')).toBe(50)
  })

  it('reflects uneven weights', () => {
    const g = group({
      members: [member({ userId: 'a', shareWeight: 3 }), member({ userId: 'b', shareWeight: 1 })],
    })
    expect(memberSharePct(g, 'a')).toBe(75)
    expect(memberSharePct(g, 'b')).toBe(25)
  })

  it('handles a single member as 100%', () => {
    expect(memberSharePct(group({ members: [member({ userId: 'a' })] }), 'a')).toBe(100)
  })

  it('returns 0 for an unknown member', () => {
    expect(memberSharePct(group({ members: [member({ userId: 'a' })] }), 'zzz')).toBe(0)
  })

  it('returns 0 (no divide-by-zero) when weights sum to zero', () => {
    const g = group({ members: [member({ userId: 'a', shareWeight: 0 })] })
    expect(memberSharePct(g, 'a')).toBe(0)
  })
})

describe('payerDefaultAccountId', () => {
  it('returns the selected payer’s default payment account', () => {
    const g = group({
      members: [
        member({ userId: 'a', defaultPaymentAccountId: 'acc-a' }),
        member({ userId: 'b', defaultPaymentAccountId: 'acc-b' }),
      ],
    })
    expect(payerDefaultAccountId(g, 'a')).toBe('acc-a')
    expect(payerDefaultAccountId(g, 'b')).toBe('acc-b')
  })

  it('returns null when the payer has no default', () => {
    const g = group({ members: [member({ userId: 'a', defaultPaymentAccountId: null })] })
    expect(payerDefaultAccountId(g, 'a')).toBeNull()
  })

  it('returns null for an unknown payer', () => {
    expect(payerDefaultAccountId(group({ members: [] }), 'a')).toBeNull()
  })
})

describe('resolveMyUserId', () => {
  const g = group({
    members: [member({ userId: 'a', userEmail: 'me@x.test' }), member({ userId: 'b' })],
  })

  it('matches the caller by email', () => {
    expect(resolveMyUserId(g, 'me@x.test')).toBe('a')
  })

  it('returns null for a non-member email', () => {
    expect(resolveMyUserId(g, 'stranger@x.test')).toBeNull()
  })

  it('returns null for a null email', () => {
    expect(resolveMyUserId(g, null)).toBeNull()
  })
})

describe('defaultPayerId', () => {
  const g = group({ members: [member({ userId: 'a' }), member({ userId: 'b' })] })

  it('prefers the caller', () => {
    expect(defaultPayerId(g, 'b')).toBe('b')
  })

  it('falls back to the first member when the caller is unknown', () => {
    expect(defaultPayerId(g, null)).toBe('a')
  })

  it('returns null for an empty group', () => {
    expect(defaultPayerId(group({ members: [] }), null)).toBeNull()
  })
})
