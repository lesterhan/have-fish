import { describe, it, expect } from 'bun:test'
import {
  RECENT_LIMIT,
  pinnedRows,
  recentRows,
  type SidebarAccount,
} from './sidebarAccounts'
import type { Roots } from './accountPaths'

const ROOTS: Roots = {
  assets: 'assets',
  liabilities: 'liabilities',
  equity: 'equity',
  expenses: 'expenses',
  income: 'income',
}

function acct(id: string, path: string, name?: string): SidebarAccount {
  return { id, path, name }
}

const NONE = { pinnedIds: new Set<string>(), hiddenIds: new Set<string>() }

describe('pinnedRows', () => {
  const accounts = [
    acct('1', 'assets:wise:cad'),
    acct('2', 'liabilities:amex', 'Amex Cobalt'),
    acct('3', 'assets:chequing'),
  ]

  it('keeps the order the ids were pinned in, not the account order', () => {
    expect(pinnedRows(accounts, ['3', '1'], ROOTS).map((r) => r.id)).toEqual([
      '3',
      '1',
    ])
  })

  it('labels each row against its own surface root', () => {
    expect(pinnedRows(accounts, ['1', '2'], ROOTS).map((r) => r.label)).toEqual([
      'wise:cad',
      'Amex Cobalt',
    ])
  })

  it('drops an id that no longer resolves rather than rendering a blank', () => {
    // A pinned account can be deleted; the stale id is not worth a write to clean up.
    expect(pinnedRows(accounts, ['1', 'gone', '2'], ROOTS).map((r) => r.id)).toEqual(
      ['1', '2'],
    )
  })

  it('is empty when nothing is pinned', () => {
    expect(pinnedRows(accounts, [], ROOTS)).toEqual([])
  })
})

describe('recentRows', () => {
  const accounts = [
    acct('chq', 'assets:chequing'),
    acct('sav', 'assets:savings'),
    acct('visa', 'liabilities:visa'),
    acct('tfsa', 'equity:tfsa'),
    acct('food', 'expenses:food'),
    acct('never', 'assets:dormant'),
  ]

  const activity = new Map<string, string | null>([
    ['chq', '2026-08-20'],
    ['sav', '2026-08-27'],
    ['visa', '2026-08-25'],
    ['tfsa', '2026-01-01'],
    ['food', '2026-08-29'], // the most recent of all, and not a place you navigate to
    ['never', null],
  ])

  it('ranks by last activity, newest first', () => {
    expect(
      recentRows(accounts, activity, ROOTS, NONE).map((r) => r.id),
    ).toEqual(['sav', 'visa', 'chq'])
  })

  it('leaves out expense categories, however recently they were posted to', () => {
    const ids = recentRows(accounts, activity, ROOTS, NONE, 10).map((r) => r.id)
    expect(ids).not.toContain('food')
  })

  it('leaves out an account that has never been transacted in', () => {
    const ids = recentRows(accounts, activity, ROOTS, NONE, 10).map((r) => r.id)
    expect(ids).not.toContain('never')
  })

  it('excludes pinned accounts, which already have a row', () => {
    expect(
      recentRows(accounts, activity, ROOTS, {
        pinnedIds: new Set(['sav']),
        hiddenIds: new Set(),
      }).map((r) => r.id),
    ).toEqual(['visa', 'chq', 'tfsa'])
  })

  it('excludes hidden accounts, since hiding one asks not to see it', () => {
    expect(
      recentRows(accounts, activity, ROOTS, {
        pinnedIds: new Set(),
        hiddenIds: new Set(['sav', 'visa']),
      }).map((r) => r.id),
    ).toEqual(['chq', 'tfsa'])
  })

  it('keeps unfiled accounts, which are still places you go', () => {
    const withStray = [...accounts, acct('stray', '储蓄:中国银行')]
    const withActivity = new Map(activity).set('stray', '2026-08-28')
    expect(
      recentRows(withStray, withActivity, ROOTS, NONE).map((r) => r.id),
    ).toEqual(['stray', 'sav', 'visa'])
  })

  it('caps the list at the limit', () => {
    expect(recentRows(accounts, activity, ROOTS, NONE)).toHaveLength(RECENT_LIMIT)
    expect(recentRows(accounts, activity, ROOTS, NONE, 1).map((r) => r.id)).toEqual([
      'sav',
    ])
  })

  it('breaks a same-day tie on the path, so the order does not flicker', () => {
    const tied = [acct('b', 'assets:bbb'), acct('a', 'assets:aaa')]
    const sameDay = new Map([
      ['a', '2026-08-20'],
      ['b', '2026-08-20'],
    ])
    expect(recentRows(tied, sameDay, ROOTS, NONE).map((r) => r.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('is empty when nothing has been transacted in', () => {
    expect(recentRows(accounts, new Map(), ROOTS, NONE)).toEqual([])
  })
})
