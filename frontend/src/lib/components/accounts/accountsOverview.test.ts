import { describe, it, expect } from 'bun:test'
import {
  NO_RATES,
  bucketOf,
  buildRows,
  convertBalances,
  convertRows,
  coverageNote,
  currenciesNeedingRates,
  daysBetween,
  formatCents,
  groupCurrency,
  groupRows,
  heldElsewhereNote,
  institutionOf,
  isUnderRoot,
  localToday,
  positionTotals,
  shortPath,
  surfaceOf,
  toCents,
  type Money,
  type OverviewAccount,
  type Roots,
} from './accountsOverview'

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

describe('isUnderRoot', () => {
  it('matches the root itself and anything below it', () => {
    expect(isUnderRoot('assets', 'assets')).toBe(true)
    expect(isUnderRoot('assets:wise:cad', 'assets')).toBe(true)
  })

  it('anchors on the separator so a shared prefix is not a match', () => {
    expect(isUnderRoot('assetsold:chequing', 'assets')).toBe(false)
    expect(isUnderRoot('assetsold', 'assets')).toBe(false)
  })

  it('treats an empty root as matching nothing rather than everything', () => {
    expect(isUnderRoot('assets:chequing', '')).toBe(false)
  })
})

describe('surfaceOf', () => {
  it('files each configured root', () => {
    expect(surfaceOf('assets:wise:cad', ROOTS)).toBe('assets')
    expect(surfaceOf('liabilities:visa', ROOTS)).toBe('liabilities')
    expect(surfaceOf('equity:tfsa', ROOTS)).toBe('equity')
    expect(surfaceOf('expenses:food', ROOTS)).toBe('expenses')
    expect(surfaceOf('income:salary', ROOTS)).toBe('income')
  })

  it('files anything outside every root as unfiled', () => {
    expect(surfaceOf('储蓄:中国银行', ROOTS)).toBe('unfiled')
    expect(surfaceOf('asset:typo', ROOTS)).toBe('unfiled')
  })

  it('follows renamed roots', () => {
    const custom: Roots = { ...ROOTS, assets: 'activos' }
    expect(surfaceOf('activos:banco', custom)).toBe('assets')
    // The old root is now just another unfiled path — which is the point of the bucket.
    expect(surfaceOf('assets:chequing', custom)).toBe('unfiled')
  })
})

describe('bucketOf', () => {
  it('splits assets into cash and owed by the receivable subtree', () => {
    expect(bucketOf('assets:wise:cad', ROOTS)).toBe('cash')
    expect(bucketOf('assets:receivable:alice', ROOTS)).toBe('owed')
  })

  it('maps liabilities to owing and equity to investments', () => {
    expect(bucketOf('liabilities:visa', ROOTS)).toBe('owing')
    expect(bucketOf('equity:tfsa', ROOTS)).toBe('investments')
  })

  it('gives unfiled, expense and income accounts no bucket', () => {
    expect(bucketOf('储蓄:中国银行', ROOTS)).toBeNull()
    expect(bucketOf('expenses:food', ROOTS)).toBeNull()
    expect(bucketOf('income:salary', ROOTS)).toBeNull()
  })

  it('does not mistake a receivable-prefixed sibling for a receivable', () => {
    expect(bucketOf('assets:receivables:old', ROOTS)).toBe('cash')
  })
})

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

describe('localToday', () => {
  it('formats the viewer\'s own calendar day, zero-padded', () => {
    expect(localToday(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localToday(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('shortPath', () => {
  it('strips the root prefix', () => {
    expect(shortPath('assets:wise:cad', 'assets')).toBe('wise:cad')
  })

  it('leaves a path that is not under the root alone', () => {
    expect(shortPath('储蓄:中国银行', 'assets')).toBe('储蓄:中国银行')
    expect(shortPath('assets', 'assets')).toBe('assets')
  })
})

describe('buildRows', () => {
  it('prefers the account name over the shortened path', () => {
    const [row] = rowsFor([acct('assets:wise:cad', [], { name: 'Wise CAD' })])
    expect(row!.displayName).toBe('Wise CAD')
  })

  it('falls back to the path with its root stripped', () => {
    const [row] = rowsFor([acct('assets:wise:cad')])
    expect(row!.displayName).toBe('wise:cad')
  })

  it('keeps an unfiled path whole, since it has no root to strip', () => {
    const [row] = rowsFor([acct('储蓄:中国银行')])
    expect(row!.displayName).toBe('储蓄:中国银行')
    expect(row!.surface).toBe('unfiled')
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

describe('institutionOf', () => {
  it('reads path segment 2 when something sits below it', () => {
    expect(institutionOf('liabilities:wealthsimple:visa')).toBe('wealthsimple')
    expect(institutionOf('assets:wise:cad')).toBe('wise')
  })

  it('has none for a standalone account, which is not an institution of one', () => {
    // Otherwise a page of accounts becomes a page of one-row groups.
    expect(institutionOf('assets:chequing')).toBeNull()
    expect(institutionOf('assets')).toBeNull()
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

describe('toCents / formatCents', () => {
  it('round-trips a numeric(12,2) string', () => {
    expect(toCents('1234.56')).toBe(123456)
    expect(toCents('-1234.56')).toBe(-123456)
    expect(formatCents(123456)).toBe('1,234.56')
  })

  it('renders a negative with a true minus sign, not a hyphen', () => {
    expect(formatCents(-500)).toBe('−5.00')
  })

  it('pads the cents', () => {
    expect(formatCents(105)).toBe('1.05')
    expect(formatCents(100)).toBe('1.00')
  })

  it('is null for an unparseable amount rather than NaN', () => {
    expect(toCents('')).toBeNull()
    expect(toCents('n/a')).toBeNull()
  })

  it('does not drift on amounts that float arithmetic gets wrong', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it is exact.
    expect(toCents('0.10')! + toCents('0.20')!).toBe(30)
  })
})

describe('convertBalances', () => {
  const rates = new Map([
    ['USD', 1.4],
    ['EUR', 1.5],
  ])

  it('passes the preferred currency through untouched', () => {
    expect(
      convertBalances([{ currency: 'CAD', amount: '100.00' }], rates, 'CAD'),
    ).toEqual({ cents: 10000, missing: [], included: ['CAD'] })
  })

  it('applies the rate for a foreign currency', () => {
    expect(
      convertBalances([{ currency: 'USD', amount: '100.00' }], rates, 'CAD'),
    ).toEqual({ cents: 14000, missing: [], included: ['USD'] })
  })

  it('excludes a balance with no rate and names its currency', () => {
    const out = convertBalances(
      [
        { currency: 'CAD', amount: '100.00' },
        { currency: 'CZK', amount: '999.00' },
      ],
      rates,
      'CAD',
    )
    // The CZK leg is left out entirely rather than counted as zero or at par.
    expect(out).toEqual({ cents: 10000, missing: ['CZK'], included: ['CAD'] })
  })

  it('names each missing currency once, sorted', () => {
    const out = convertBalances(
      [
        { currency: 'CZK', amount: '1.00' },
        { currency: 'CZK', amount: '2.00' },
        { currency: 'AUD', amount: '3.00' },
      ],
      rates,
      'CAD',
    )
    expect(out.missing).toEqual(['AUD', 'CZK'])
  })

  it('treats an unparseable amount as missing rather than summing NaN', () => {
    const out = convertBalances(
      [{ currency: 'CAD', amount: 'oops' }],
      rates,
      'CAD',
    )
    expect(out.cents).toBe(0)
    expect(out.missing).toEqual(['CAD'])
  })

  it('sums an empty set to zero with nothing missing', () => {
    expect(convertBalances([], rates, 'CAD')).toEqual({
      cents: 0,
      missing: [],
      included: [],
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

describe('coverageNote', () => {
  const rates = new Map([['USD', 1.4]])

  function note(balances: Money[], r = rates, preferred = 'CAD') {
    return coverageNote(convertBalances(balances, r, preferred), preferred)
  }

  it('says nothing when every balance made it into the total', () => {
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
      ]),
    ).toBeNull()
  })

  it('says "CAD only" when nothing but the preferred currency converted', () => {
    // The usual case: the rate source is unreachable, so no foreign leg resolves.
    expect(
      note(
        [
          { currency: 'CAD', amount: '1.00' },
          { currency: 'CZK', amount: '1.00' },
          { currency: 'USD', amount: '1.00' },
        ],
        new Map(),
      ),
    ).toBe('CAD only')
  })

  it('does not grow with the number of excluded currencies', () => {
    // A trip through four countries must not produce a note longer than the figure.
    expect(
      note(
        [
          { currency: 'CAD', amount: '1.00' },
          { currency: 'CZK', amount: '1.00' },
          { currency: 'EUR', amount: '1.00' },
          { currency: 'HUF', amount: '1.00' },
          { currency: 'PLN', amount: '1.00' },
        ],
        new Map(),
      ),
    ).toBe('CAD only')
  })

  it('never claims "CAD only" for a total holding no CAD at all', () => {
    expect(note([{ currency: 'CZK', amount: '1.00' }], new Map())).toBe(
      'no rate available',
    )
  })

  it('never claims "CAD only" when some foreign rates did resolve', () => {
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
        { currency: 'CZK', amount: '1.00' },
      ]),
    ).toBe('2 of 3 currencies')
  })

  it('counts a currency once when it is both summed and unusable', () => {
    // One good CAD row and one unparseable CAD row put CAD in both sets.
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'CAD', amount: '' },
        { currency: 'USD', amount: '1.00' },
      ]),
    ).toBe('2 of 2 currencies')
  })

  it('follows the preferred currency rather than hard-coding CAD', () => {
    expect(
      note(
        [
          { currency: 'EUR', amount: '1.00' },
          { currency: 'CZK', amount: '1.00' },
        ],
        new Map(),
        'EUR',
      ),
    ).toBe('EUR only')
  })
})

describe('heldElsewhereNote', () => {
  function note(balances: Money[], preferred = 'CAD') {
    // NO_RATES is the page's resting state: nothing is converted until someone asks.
    return heldElsewhereNote(
      convertBalances(balances, NO_RATES, preferred),
      preferred,
    )
  }

  it('says nothing when the preferred currency is all there is', () => {
    expect(note([{ currency: 'CAD', amount: '40300.00' }])).toBeNull()
  })

  it('says nothing for an account with no balances at all', () => {
    expect(note([])).toBeNull()
  })

  it('counts the other currencies held without pricing them', () => {
    expect(
      note([
        { currency: 'CAD', amount: '40300.00' },
        { currency: 'USD', amount: '900.00' },
        { currency: 'CZK', amount: '120.00' },
      ]),
    ).toBe('+ 2 currencies held')
  })

  it('says currency, singular, for one', () => {
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
      ]),
    ).toBe('+ 1 currency held')
  })

  it('counts a currency once however many accounts hold it', () => {
    expect(
      note([
        { currency: 'USD', amount: '1.00' },
        { currency: 'USD', amount: '2.00' },
        { currency: 'USD', amount: '3.00' },
      ]),
    ).toBe('+ 1 currency held')
  })

  it('does not report the preferred currency as foreign when an amount is unreadable', () => {
    expect(note([{ currency: 'CAD', amount: '' }])).toBeNull()
  })

  it('follows the preferred currency rather than hard-coding CAD', () => {
    expect(
      note(
        [
          { currency: 'EUR', amount: '1.00' },
          { currency: 'CAD', amount: '1.00' },
        ],
        'EUR',
      ),
    ).toBe('+ 1 currency held')
  })

  it('leaves the unconverted total exact — it is a sum, not an estimate', () => {
    const total = convertBalances(
      [
        { currency: 'CAD', amount: '40300.00' },
        { currency: 'USD', amount: '900.00' },
      ],
      NO_RATES,
      'CAD',
    )
    expect(total.cents).toBe(4030000)
    expect(total.included).toEqual(['CAD'])
  })
})
