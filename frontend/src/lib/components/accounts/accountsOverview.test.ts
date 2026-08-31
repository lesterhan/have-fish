import { describe, it, expect } from 'bun:test'
import {
  buildRows,
  convertRows,
  currenciesNeedingRates,
  daysBetween,
  groupCurrency,
  groupRows,
  positionTotals,
  type OverviewAccount,
} from './accountsOverview'
import type { Roots } from './accountPaths'
import type { Money } from '../../money'

const ROOTS: Roots = {
  assets: 'assets',
  liabilities: 'liabilities',
  equity: 'equity',
  expenses: 'expenses',
  income: 'income',
}

function acct(
  path: string,
  balances: Money[] = [],
  extra: Partial<OverviewAccount> = {},
): OverviewAccount {
  return { id: path, path, balances, ...extra }
}

function rowsFor(accounts: OverviewAccount[], today = '2026-08-29') {
  return buildRows(accounts, ROOTS, new Map(), today)
}

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-08-01', '2026-08-29')).toBe(28)
    expect(daysBetween('2026-08-29', '2026-08-29')).toBe(0)
  })

  it('is null for a never-used account', () => {
    expect(daysBetween(null, '2026-08-29')).toBeNull()
  })

  it('is null rather than NaN for an unparseable date', () => {
    expect(daysBetween('never', '2026-08-29')).toBeNull()
  })

  it('crosses a DST boundary without drifting a day', () => {
    // Northern-hemisphere spring forward sits inside this range.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
  })
})

describe('buildRows', () => {
  // Naming itself belongs to accountPaths and is tested there. What matters here is that each
  // row is handed *its own* surface's root, so a liability is not shortened against `assets`.
  it('strips each row against the root of its own surface', () => {
    const rows = rowsFor([
      acct('assets:wise:cad'),
      acct('liabilities:amex'),
      acct('储蓄:中国银行'),
    ])
    expect(rows.map((r) => r.displayName)).toEqual([
      'wise:cad',
      'amex',
      '储蓄:中国银行',
    ])
    expect(rows[2]!.surface).toBe('unfiled')
  })

  it('carries last activity and derives idle days from it', () => {
    const rows = buildRows(
      [acct('assets:chequing'), acct('assets:dormant')],
      ROOTS,
      new Map([['assets:chequing', '2026-08-01']]),
      '2026-08-29',
    )
    expect(rows[0]!.lastActivity).toBe('2026-08-01')
    expect(rows[0]!.idleDays).toBe(28)
    expect(rows[1]!.lastActivity).toBeNull()
    expect(rows[1]!.idleDays).toBeNull()
  })
})

describe('groupRows', () => {
  it('groups by institution and title-cases the label', () => {
    const groups = groupRows(
      rowsFor([
        acct('assets:wise:cad'),
        acct('assets:wise:usd'),
        acct('liabilities:wealthsimple:visa'),
      ]),
      'institution',
    )
    expect(groups.map((g) => g.label)).toEqual(['Wealthsimple', 'Wise'])
    expect(groups[1]!.rows.map((r) => r.displayName)).toEqual([
      'wise:cad',
      'wise:usd',
    ])
  })

  it('files a standalone account under its surface rather than its own institution', () => {
    const groups = groupRows(
      rowsFor([
        acct('assets:chequing'),
        acct('assets:savings'),
        acct('assets:wise:cad'),
        acct('liabilities:amex'),
      ]),
      'institution',
    )
    expect(groups.map((g) => g.label)).toEqual(['Assets', 'Liabilities', 'Wise'])
    expect(groups[0]!.rows.map((r) => r.displayName)).toEqual([
      'chequing',
      'savings',
    ])
  })

  it('groups by resolved type, not by path root', () => {
    const groups = groupRows(
      rowsFor([
        // A liabilities-rooted account overridden to asset must group with the assets.
        acct('liabilities:oddity', [], { resolvedType: 'asset' }),
        acct('assets:chequing', [], { resolvedType: 'asset' }),
        acct('liabilities:visa', [], { resolvedType: 'liability' }),
      ]),
      'type',
    )
    expect(groups.map((g) => g.label)).toEqual(['Assets', 'Liabilities'])
    expect(groups[0]!.rows).toHaveLength(2)
  })

  it('folds the cash and conversion override types into their classifier buckets', () => {
    const groups = groupRows(
      rowsFor([
        acct('assets:wallet', [], { resolvedType: 'cash' }),
        acct('equity:conversions', [], { resolvedType: 'conversion' }),
      ]),
      'type',
    )
    expect(groups.map((g) => g.label)).toEqual(['Assets', 'Equity'])
  })

  it('falls back to the surface when an account has no resolved type', () => {
    const groups = groupRows(rowsFor([acct('assets:chequing')]), 'type')
    expect(groups.map((g) => g.label)).toEqual(['Assets'])
  })

  it('lists a multi-currency account once per currency, showing only that balance', () => {
    const groups = groupRows(
      rowsFor([
        acct('assets:wise', [
          { currency: 'CAD', amount: '100.00' },
          { currency: 'USD', amount: '50.00' },
        ]),
        acct('assets:chequing', [{ currency: 'CAD', amount: '10.00' }]),
      ]),
      'currency',
    )
    expect(groups.map((g) => g.label)).toEqual(['CAD', 'USD'])
    expect(groups[0]!.rows).toHaveLength(2)
    expect(groups[1]!.rows).toHaveLength(1)
    // The USD group shows the USD leg alone, so its total is an exact native sum.
    expect(groups[1]!.rows[0]!.balances).toEqual([
      { currency: 'USD', amount: '50.00' },
    ])
  })

  it('sends an account with no balances to its own group, sorted last', () => {
    const groups = groupRows(
      rowsFor([
        acct('assets:unused'),
        acct('assets:chequing', [{ currency: 'CAD', amount: '10.00' }]),
      ]),
      'currency',
    )
    expect(groups.map((g) => g.label)).toEqual(['CAD', 'No balance'])
  })

  it('puts everything in one group when flat', () => {
    const groups = groupRows(
      rowsFor([acct('assets:wise:cad'), acct('liabilities:visa')]),
      'flat',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.rows).toHaveLength(2)
  })

  it('keeps unfiled accounts in their own group under every grouping, sorted last', () => {
    for (const grouping of ['institution', 'type', 'currency', 'flat'] as const) {
      const groups = groupRows(
        rowsFor([
          acct('储蓄:中国银行', [{ currency: 'CNY', amount: '1.00' }]),
          acct('assets:wise:cad', [{ currency: 'CAD', amount: '1.00' }]),
        ]),
        grouping,
      )
      expect(groups.at(-1)!.label).toBe('Unfiled')
      expect(groups.at(-1)!.rows).toHaveLength(1)
    }
  })

  it('sorts rows within a group by display name, not by path', () => {
    const groups = groupRows(
      rowsFor([
        acct('assets:wise:aaa', [], { name: 'Zebra' }),
        acct('assets:wise:zzz', [], { name: 'Apple' }),
      ]),
      'institution',
    )
    expect(groups[0]!.rows.map((r) => r.displayName)).toEqual([
      'Apple',
      'Zebra',
    ])
  })
})

describe('groupCurrency', () => {
  it('names the single currency of a currency group', () => {
    const groups = groupRows(
      rowsFor([acct('assets:cz', [{ currency: 'CZK', amount: '1.00' }])]),
      'currency',
    )
    expect(groupCurrency(groups[0]!)).toBe('CZK')
  })

  it('is null for a group that is not a single currency', () => {
    const institution = groupRows(rowsFor([acct('assets:wise:cad')]), 'institution')
    expect(groupCurrency(institution[0]!)).toBeNull()

    // No-balance and Unfiled both hold rows of mixed or absent currency.
    const noBalance = groupRows(rowsFor([acct('assets:unused')]), 'currency')
    expect(groupCurrency(noBalance[0]!)).toBeNull()

    const unfiled = groupRows(
      rowsFor([acct('储蓄:中国银行', [{ currency: 'CNY', amount: '1.00' }])]),
      'currency',
    )
    expect(groupCurrency(unfiled[0]!)).toBeNull()
  })

  it('totals a currency group exactly, with no rate available at all', () => {
    const groups = groupRows(
      rowsFor([
        acct('assets:cz', [{ currency: 'CZK', amount: '120.00' }]),
        acct('assets:cz2', [{ currency: 'CZK', amount: '5.50' }]),
      ]),
      'currency',
    )
    const code = groupCurrency(groups[0]!)!
    expect(convertRows(groups[0]!.rows, new Map(), code)).toEqual({
      cents: 12550,
      missing: [],
      included: ['CZK'],
    })
  })
})

describe('currenciesNeedingRates', () => {
  it('lists every foreign currency once, excluding the preferred one', () => {
    const rows = rowsFor([
      acct('assets:wise', [
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
      ]),
      acct('assets:cz', [{ currency: 'CZK', amount: '1.00' }]),
      acct('liabilities:us', [{ currency: 'USD', amount: '-1.00' }]),
    ])
    expect(currenciesNeedingRates(rows, 'CAD')).toEqual(['CZK', 'USD'])
  })

  it('reads the account\'s whole balance set, not the row\'s narrowed one', () => {
    // Currency grouping narrows Row.balances; the rate list must still cover both legs.
    const rows = groupRows(
      rowsFor([
        acct('assets:wise', [
          { currency: 'USD', amount: '1.00' },
          { currency: 'EUR', amount: '1.00' },
        ]),
      ]),
      'currency',
    ).flatMap((g) => g.rows)
    expect(currenciesNeedingRates(rows, 'CAD')).toEqual(['EUR', 'USD'])
  })
})

describe('convertRows', () => {
  it('sums the balances the rows display, not the accounts behind them', () => {
    // Currency grouping is the case that matters: the USD group must total USD alone.
    const groups = groupRows(
      rowsFor([
        acct('assets:wise', [
          { currency: 'CAD', amount: '100.00' },
          { currency: 'USD', amount: '100.00' },
        ]),
      ]),
      'currency',
    )
    const usd = groups.find((g) => g.label === 'USD')!
    expect(convertRows(usd.rows, new Map([['USD', 1.4]]), 'CAD').cents).toBe(
      14000,
    )
  })
})

describe('positionTotals', () => {
  const rates = new Map([['USD', 1.4]])

  const rows = rowsFor([
    acct('assets:chequing', [{ currency: 'CAD', amount: '1000.00' }]),
    acct('assets:wise:usd', [{ currency: 'USD', amount: '100.00' }]),
    acct('assets:receivable:alice', [{ currency: 'CAD', amount: '25.00' }]),
    acct('equity:tfsa', [{ currency: 'CAD', amount: '5000.00' }]),
    acct('liabilities:visa', [{ currency: 'CAD', amount: '-300.00' }]),
    // Neither of these feeds a bucket.
    acct('expenses:food', [{ currency: 'CAD', amount: '42.00' }]),
    acct('储蓄:中国银行', [{ currency: 'CNY', amount: '900.00' }]),
  ])

  it('splits the four buckets from the paths alone', () => {
    const totals = positionTotals(rows, ROOTS, rates, 'CAD')
    expect(totals.cash.cents).toBe(100000 + 14000)
    expect(totals.owed.cents).toBe(2500)
    expect(totals.investments.cents).toBe(500000)
    expect(totals.owing.cents).toBe(-30000)
  })

  it('keeps expenses and unfiled money out of every bucket', () => {
    const totals = positionTotals(rows, ROOTS, rates, 'CAD')
    const sum =
      totals.cash.cents +
      totals.owed.cents +
      totals.investments.cents +
      totals.owing.cents
    expect(sum).toBe(100000 + 14000 + 2500 + 500000 - 30000)
  })

  it('reports a bucket short a rate rather than under-reporting it silently', () => {
    const totals = positionTotals(rows, ROOTS, new Map(), 'CAD')
    expect(totals.cash.cents).toBe(100000)
    expect(totals.cash.missing).toEqual(['USD'])
  })

  it('leaves every bucket at zero when there is nothing to sum', () => {
    const totals = positionTotals([], ROOTS, rates, 'CAD')
    expect(totals.cash).toEqual({ cents: 0, missing: [], included: [] })
    expect(totals.owing).toEqual({ cents: 0, missing: [], included: [] })
  })
})
