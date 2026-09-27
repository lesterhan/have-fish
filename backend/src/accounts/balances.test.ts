import { describe, expect, it } from 'bun:test'
import type { StoredAccountType } from '../postings/account-type'
import { BALANCE_BEARING_TYPES, readBalanceSelection, selects, sumByCurrency } from './balances'

describe('BALANCE_BEARING_TYPES', () => {
  it('is money held or owed, Cash and Conversion included', () => {
    expect([...BALANCE_BEARING_TYPES].sort()).toEqual([
      'asset',
      'cash',
      'conversion',
      'equity',
      'liability',
    ])
  })
})

describe('readBalanceSelection', () => {
  it('defaults to balance-bearing, optionally with unfiled', () => {
    expect(readBalanceSelection(undefined, undefined)).toEqual({
      ok: true,
      value: { kind: 'balanceBearing', includeUnfiled: false },
    })
    expect(readBalanceSelection(undefined, 'unfiled')).toEqual({
      ok: true,
      value: { kind: 'balanceBearing', includeUnfiled: true },
    })
  })

  it('reads a list of types, trimming each', () => {
    const r = readBalanceSelection('cash, asset', undefined)
    expect(r.ok && r.value.kind === 'types' && [...r.value.types]).toEqual(['cash', 'asset'])
  })

  it('refuses an include it does not know', () => {
    expect(readBalanceSelection(undefined, 'all')).toEqual({
      ok: false,
      failure: { error: 'ACCOUNT_INCLUDE_INVALID', detail: { value: 'all' } },
    })
  })

  it('refuses unfiled with types, and says so before looking at the types', () => {
    for (const types of ['cash', '', 'nonsense']) {
      expect(readBalanceSelection(types, 'unfiled')).toEqual({
        ok: false,
        failure: { error: 'ACCOUNT_INCLUDE_UNFILED_WITH_TYPES' },
      })
    }
  })

  it('refuses an empty list or an empty entry rather than widening', () => {
    for (const types of ['', ',', 'cash,', ' , asset']) {
      expect(readBalanceSelection(types, undefined)).toEqual({
        ok: false,
        failure: { error: 'FIELD_EMPTY', detail: { field: 'types' } },
      })
    }
  })

  it('refuses the first type that is not one of the seven', () => {
    expect(readBalanceSelection('cash,wallet,bogus', undefined)).toEqual({
      ok: false,
      failure: { error: 'ACCOUNT_TYPE_INVALID', detail: { type: 'wallet' } },
    })
  })
})

describe('selects', () => {
  const all: (StoredAccountType | null)[] = [
    'asset',
    'cash',
    'liability',
    'equity',
    'conversion',
    'income',
    'expense',
    null,
  ]
  const picked = (selection: Parameters<typeof selects>[0]) =>
    all.filter((t) => selects(selection, t))

  it('keeps balance-bearing types by default, never income or expense', () => {
    expect(picked({ kind: 'balanceBearing', includeUnfiled: false })).toEqual([
      'asset',
      'cash',
      'liability',
      'equity',
      'conversion',
    ])
  })

  it('adds untyped accounts with unfiled', () => {
    expect(picked({ kind: 'balanceBearing', includeUnfiled: true })).toEqual([
      'asset',
      'cash',
      'liability',
      'equity',
      'conversion',
      null,
    ])
  })

  it('keeps exactly the types asked for, and never an untyped account', () => {
    expect(picked({ kind: 'types', types: new Set(['cash', 'expense']) })).toEqual([
      'cash',
      'expense',
    ])
  })
})

describe('sumByCurrency', () => {
  it('sums in cents per currency, in the order currencies first appear', () => {
    expect(
      sumByCurrency([
        { currency: 'EUR', amount: '0.10' },
        { currency: 'CAD', amount: '0.20' },
        { currency: 'EUR', amount: '0.20' },
        { currency: 'CAD', amount: '-0.20' },
      ]),
    ).toEqual([
      { currency: 'EUR', amount: '0.30' },
      { currency: 'CAD', amount: '0.00' },
    ])
  })

  it('is empty for no rows', () => {
    expect(sumByCurrency([])).toEqual([])
  })
})
