/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import type { Account, ExpenseGroup, GroupCategory, GroupMember } from './api'
import {
  QUICK_CURRENCIES,
  accountRows,
  activeCategories,
  categoryHasOverride,
  categoryWeightRows,
  groupCard,
  inheritsBaseline,
  percent,
  splitRows,
} from './settings-view'

function member(over: Partial<GroupMember> = {}): GroupMember {
  return {
    id: 'm1',
    groupId: 'g1',
    userId: 'u1',
    shareWeight: 1,
    defaultExpenseAccountId: null,
    defaultPaymentAccountId: null,
    joinedAt: '2026-01-01T00:00:00Z',
    userName: 'Ada',
    userEmail: 'ada@example.com',
    ...over,
  }
}

function category(over: Partial<GroupCategory> = {}): GroupCategory {
  return {
    id: 'c1',
    groupId: 'g1',
    name: 'Food',
    sortOrder: 0,
    archivedAt: null,
    myMapping: { accountId: 'a1' },
    weights: [],
    ...over,
  }
}

function account(over: Partial<Account> = {}): Account {
  return { id: 'a1', path: 'expenses:food', ...over }
}

function group(over: Partial<ExpenseGroup> = {}): ExpenseGroup {
  return {
    id: 'g1',
    name: 'Trip',
    defaultCurrency: 'CAD',
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    members: [member()],
    categories: [category()],
    ...over,
  }
}

describe('groupCard', () => {
  it('summarizes name, currency and member count', () => {
    const g = group({
      name: 'Japan 2026',
      defaultCurrency: 'JPY',
      members: [member({ userId: 'u1' }), member({ userId: 'u2' })],
    })
    expect(groupCard(g)).toEqual({ name: 'Japan 2026', currency: 'JPY', memberCount: 2 })
  })

  it('falls back to an em dash when no default currency', () => {
    expect(groupCard(group({ defaultCurrency: null })).currency).toBe('—')
  })
})

describe('percent', () => {
  it('computes a whole-percent share', () => {
    expect(percent(1, 4)).toBe(25)
    expect(percent(3, 4)).toBe(75)
  })

  it('guards against a zero/negative total', () => {
    expect(percent(2, 0)).toBe(0)
  })
})

describe('splitRows', () => {
  it('maps members to weight + percent rows from the baseline', () => {
    const rows = splitRows([
      member({ userId: 'u1', userName: 'Ada', shareWeight: 3 }),
      member({ userId: 'u2', userName: 'Bo', shareWeight: 1 }),
    ])
    expect(rows).toEqual([
      { userId: 'u1', name: 'Ada', weight: 3, percent: 75 },
      { userId: 'u2', name: 'Bo', weight: 1, percent: 25 },
    ])
  })

  it('renders a single member as 100%', () => {
    expect(splitRows([member({ shareWeight: 5 })])[0].percent).toBe(100)
  })
})

describe('activeCategories', () => {
  it('drops archived categories and sorts by sortOrder', () => {
    const cats = [
      category({ id: 'c2', name: 'Travel', sortOrder: 2 }),
      category({ id: 'c3', name: 'Old', archivedAt: '2026-01-01T00:00:00Z', sortOrder: 1 }),
      category({ id: 'c1', name: 'Food', sortOrder: 0 }),
    ]
    expect(activeCategories(cats).map((c) => c.id)).toEqual(['c1', 'c2'])
  })
})

describe('accountRows', () => {
  it('resolves each category mapping to a ledger path', () => {
    const cats = [
      category({ id: 'c1', name: 'Food', myMapping: { accountId: 'a1' } }),
      category({ id: 'c2', name: 'Travel', sortOrder: 1, myMapping: { accountId: 'a2' } }),
    ]
    const accts = [account({ id: 'a1', path: 'expenses:food' }), account({ id: 'a2', path: 'expenses:travel' })]
    expect(accountRows(cats, accts)).toEqual([
      { categoryId: 'c1', name: 'Food', accountPath: 'expenses:food' },
      { categoryId: 'c2', name: 'Travel', accountPath: 'expenses:travel' },
    ])
  })

  it('degrades to null when the mapping is absent', () => {
    const rows = accountRows([category({ myMapping: null })], [account()])
    expect(rows[0].accountPath).toBeNull()
  })

  it('degrades to null when the mapped account is missing', () => {
    const rows = accountRows([category({ myMapping: { accountId: 'gone' } })], [account({ id: 'a1' })])
    expect(rows[0].accountPath).toBeNull()
  })
})

describe('categoryHasOverride / inheritsBaseline', () => {
  const members = [member({ userId: 'u1' }), member({ userId: 'u2' })]

  it('is an override only when every member is covered', () => {
    const full = category({ weights: [{ userId: 'u1', weight: 2 }, { userId: 'u2', weight: 1 }] })
    expect(categoryHasOverride(full, members)).toBe(true)
    expect(inheritsBaseline(full, members)).toBe(false)
  })

  it('a partial vector falls back to baseline', () => {
    const partial = category({ weights: [{ userId: 'u1', weight: 2 }] })
    expect(categoryHasOverride(partial, members)).toBe(false)
    expect(inheritsBaseline(partial, members)).toBe(true)
  })

  it('an empty vector inherits baseline', () => {
    expect(inheritsBaseline(category({ weights: [] }), members)).toBe(true)
  })
})

describe('categoryWeightRows', () => {
  const members = [
    member({ userId: 'u1', userName: 'Ada', shareWeight: 1 }),
    member({ userId: 'u2', userName: 'Bo', shareWeight: 1 }),
  ]

  it('uses the override weights when complete', () => {
    const cat = category({ weights: [{ userId: 'u1', weight: 3 }, { userId: 'u2', weight: 1 }] })
    expect(categoryWeightRows(cat, members)).toEqual([
      { userId: 'u1', name: 'Ada', weight: 3, percent: 75 },
      { userId: 'u2', name: 'Bo', weight: 1, percent: 25 },
    ])
  })

  it('falls back to the baseline shareWeight when not overridden', () => {
    const cat = category({ weights: [] })
    expect(categoryWeightRows(cat, members).map((r) => r.weight)).toEqual([1, 1])
  })
})

describe('QUICK_CURRENCIES', () => {
  it('is the fixed quick-pick set', () => {
    expect(QUICK_CURRENCIES).toEqual(['CAD', 'CZK', 'CNY', 'EUR'])
  })
})
