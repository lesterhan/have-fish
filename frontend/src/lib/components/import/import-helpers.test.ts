import { describe, it, expect } from 'bun:test'
import {
  currenciesInPreview,
  seedCurrencyAccounts,
  suggestedPathForCurrency,
  accountIdForCurrency,
} from './import-helpers'
import type { ParsedTransaction } from '$lib/api'

const ACCOUNTS = [
  { id: 'a-cad', path: 'assets:wise:cad' },
  { id: 'a-eur', path: 'assets:wise:eur' },
  { id: 'a-cny', path: 'assets:wise:cny' },
  { id: 'a-other', path: 'assets:chequing' },
]

function regular(currency?: string): ParsedTransaction {
  return { isTransfer: false, date: '2026-06-01', amount: '-10.00', currency }
}

function transfer(
  sourceCurrency: string,
  targetCurrency: string,
  suggestedKind?: 'spend' | 'transfer',
): ParsedTransaction {
  return {
    isTransfer: true,
    date: '2026-06-01',
    sourceAmount: '-100.00',
    sourceCurrency,
    targetAmount: '65.00',
    targetCurrency,
    suggestedKind,
  }
}

describe('currenciesInPreview', () => {
  it('falls back to the default currency for rows that carry none', () => {
    expect(currenciesInPreview([regular(), regular()], 'CAD')).toEqual(['CAD'])
  })

  it('collects each distinct currency once, in first-seen order', () => {
    const txs = [regular('CAD'), regular('EUR'), regular('CAD')]
    expect(currenciesInPreview(txs, 'CAD')).toEqual(['CAD', 'EUR'])
  })

  it('normalizes case so cad and CAD are one currency', () => {
    expect(currenciesInPreview([regular('cad'), regular('CAD')], 'CAD')).toEqual(['CAD'])
  })

  it('requires both sides of a convert-and-park', () => {
    expect(currenciesInPreview([transfer('CAD', 'EUR', 'transfer')], 'CAD')).toEqual(['CAD', 'EUR'])
  })

  it('requires only the funding side of a cross-currency spend', () => {
    // The money never lands in a CZK account — it goes straight to an expense.
    expect(currenciesInPreview([transfer('USD', 'CZK', 'spend')], 'CAD')).toEqual(['USD'])
  })

  it('includes a same-currency transfer’s currency', () => {
    const tx: ParsedTransaction = {
      isTransfer: 'same-currency',
      date: '2026-06-01',
      amount: '199.69',
      feeAmount: '0.62',
      currency: 'GBP',
    }
    expect(currenciesInPreview([tx], 'CAD')).toEqual(['GBP'])
  })

  it('ignores row-level edits by reading only the preview’s own suggestion', () => {
    // Same two rows, differing only in what the preview suggested. The required set must
    // follow the preview, so flipping a row later cannot re-gate a finished step.
    const asSpend = currenciesInPreview([transfer('USD', 'CZK', 'spend')], 'CAD')
    const asTransfer = currenciesInPreview([transfer('USD', 'CZK', 'transfer')], 'CAD')
    expect(asSpend).toEqual(['USD'])
    expect(asTransfer).toEqual(['USD', 'CZK'])
  })

  it('returns nothing for an empty preview', () => {
    expect(currenciesInPreview([], 'CAD')).toEqual([])
  })
})

describe('seedCurrencyAccounts', () => {
  it('pre-fills currencies whose conventional account exists', () => {
    const seeded = seedCurrencyAccounts(['CAD', 'EUR'], ACCOUNTS, 'assets:wise')
    expect(seeded).toEqual({ CAD: 'a-cad', EUR: 'a-eur' })
  })

  it('leaves a currency unmapped when no conventional account exists', () => {
    const seeded = seedCurrencyAccounts(['CAD', 'RMB'], ACCOUNTS, 'assets:wise')
    expect(seeded.CAD).toBe('a-cad')
    expect(seeded.RMB).toBe('')
  })

  it('keeps an existing mapping rather than re-deriving over it', () => {
    // The user pointed RMB at their CNY account; re-seeding must not undo that.
    const seeded = seedCurrencyAccounts(['RMB'], ACCOUNTS, 'assets:wise', { RMB: 'a-cny' })
    expect(seeded.RMB).toBe('a-cny')
  })

  it('drops currencies no longer present in the import', () => {
    const seeded = seedCurrencyAccounts(['CAD'], ACCOUNTS, 'assets:wise', { EUR: 'a-eur' })
    expect(Object.keys(seeded)).toEqual(['CAD'])
  })

  it('leaves everything unmapped when there is no root path', () => {
    const seeded = seedCurrencyAccounts(['CAD', 'EUR'], ACCOUNTS, null)
    expect(seeded).toEqual({ CAD: '', EUR: '' })
  })
})

describe('suggestedPathForCurrency', () => {
  it('lowercases the currency under the root', () => {
    expect(suggestedPathForCurrency('assets:wise', 'EUR')).toBe('assets:wise:eur')
  })

  it('returns an empty string without a root', () => {
    expect(suggestedPathForCurrency(null, 'EUR')).toBe('')
  })
})

describe('accountIdForCurrency', () => {
  it('resolves the conventional sub-account', () => {
    expect(accountIdForCurrency(ACCOUNTS, 'assets:wise', 'EUR')).toBe('a-eur')
  })

  it('returns empty for an unknown currency or missing root', () => {
    expect(accountIdForCurrency(ACCOUNTS, 'assets:wise', 'JPY')).toBe('')
    expect(accountIdForCurrency(ACCOUNTS, null, 'EUR')).toBe('')
  })
})
