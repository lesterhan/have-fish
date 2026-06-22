/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import type { ExpenseGroup, GroupMember } from './api'
import {
  accountChipLabel,
  nextPayerOnTap,
  resolveAccountOnPayerChange,
  seedAccountForPayer,
  shouldOpenPayerSheet,
} from './payment-row'

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

function group(members: GroupMember[]): ExpenseGroup {
  return {
    id: 'g1',
    name: 'Group',
    defaultCurrency: 'CAD',
    createdBy: 'a',
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    members,
    categories: [],
  }
}

describe('seedAccountForPayer', () => {
  it('returns the payer’s default payment account', () => {
    const g = group([
      member({ userId: 'a', defaultPaymentAccountId: 'acc-a' }),
      member({ userId: 'b', defaultPaymentAccountId: 'acc-b' }),
    ])
    expect(seedAccountForPayer(g, 'a')).toBe('acc-a')
    expect(seedAccountForPayer(g, 'b')).toBe('acc-b')
  })

  it('returns "" when the payer has no default', () => {
    const g = group([member({ userId: 'a', defaultPaymentAccountId: null })])
    expect(seedAccountForPayer(g, 'a')).toBe('')
  })

  it('returns "" for an unknown payer', () => {
    expect(seedAccountForPayer(group([]), 'a')).toBe('')
  })
})

describe('shouldOpenPayerSheet', () => {
  it('is false for 1 or 2 members (inline flip)', () => {
    expect(shouldOpenPayerSheet(group([member({ userId: 'a' })]))).toBe(false)
    expect(shouldOpenPayerSheet(group([member({ userId: 'a' }), member({ userId: 'b' })]))).toBe(false)
  })

  it('is true for 3+ members', () => {
    const g = group([member({ userId: 'a' }), member({ userId: 'b' }), member({ userId: 'c' })])
    expect(shouldOpenPayerSheet(g)).toBe(true)
  })
})

describe('nextPayerOnTap', () => {
  it('flips to the other member in a 2-member group (both directions)', () => {
    const g = group([member({ userId: 'a' }), member({ userId: 'b' })])
    expect(nextPayerOnTap(g, 'a')).toBe('b')
    expect(nextPayerOnTap(g, 'b')).toBe('a')
  })

  it('does not flip a solo group', () => {
    expect(nextPayerOnTap(group([member({ userId: 'a' })]), 'a')).toBe('a')
  })

  it('does not flip a 3+ member group (sheet handles it)', () => {
    const g = group([member({ userId: 'a' }), member({ userId: 'b' }), member({ userId: 'c' })])
    expect(nextPayerOnTap(g, 'a')).toBe('a')
  })

  it('returns the current id unchanged when it isn’t a member', () => {
    const g = group([member({ userId: 'a' }), member({ userId: 'b' })])
    expect(nextPayerOnTap(g, 'zzz')).toBe('zzz')
  })
})

describe('resolveAccountOnPayerChange', () => {
  const g = group([
    member({ userId: 'a', defaultPaymentAccountId: 'acc-a' }),
    member({ userId: 'b', defaultPaymentAccountId: 'acc-b' }),
  ])

  it('re-seeds from the new payer’s default when untouched', () => {
    expect(resolveAccountOnPayerChange(g, 'a', 'b', false, 'acc-a')).toBe('acc-b')
  })

  it('re-seeds to "" when the new payer has no default', () => {
    const g2 = group([
      member({ userId: 'a', defaultPaymentAccountId: 'acc-a' }),
      member({ userId: 'b', defaultPaymentAccountId: null }),
    ])
    expect(resolveAccountOnPayerChange(g2, 'a', 'b', false, 'acc-a')).toBe('')
  })

  it('keeps the manual override across a payer change (override wins)', () => {
    expect(resolveAccountOnPayerChange(g, 'a', 'b', true, 'acc-manual')).toBe('acc-manual')
  })

  it('keeps the current account when the payer did not change', () => {
    expect(resolveAccountOnPayerChange(g, 'a', 'a', false, 'acc-a')).toBe('acc-a')
    expect(resolveAccountOnPayerChange(g, 'a', 'a', true, 'acc-manual')).toBe('acc-manual')
  })
})

describe('accountChipLabel', () => {
  it('prefers the friendly name when set', () => {
    expect(accountChipLabel({ name: 'Wise CZK', path: 'assets:wise:czk' })).toBe('Wise CZK')
  })

  it('falls back to the full path when name is absent', () => {
    expect(accountChipLabel({ name: null, path: 'assets:wise:czk' })).toBe('assets:wise:czk')
    expect(accountChipLabel({ path: 'liabilities:visa' })).toBe('liabilities:visa')
  })

  it('falls back to the path when name is blank', () => {
    expect(accountChipLabel({ name: '   ', path: 'cash' })).toBe('cash')
  })

  it('trims surrounding whitespace from the name', () => {
    expect(accountChipLabel({ name: '  Chequing  ', path: 'assets:chequing' })).toBe('Chequing')
  })
})
