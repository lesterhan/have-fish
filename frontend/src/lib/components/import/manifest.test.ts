import { describe, it, expect } from 'bun:test'
import { buildManifest, type ManifestContext } from './manifest'
import type { RowState } from './row-state'
import type { ParsedTransaction } from '$lib/api'

const ACCOUNTS = [
  { id: 'a-groceries', path: 'expenses:groceries' },
  { id: 'a-transport', path: 'expenses:transport' },
  { id: 'a-uncat', path: 'assets:uncategorized' },
  { id: 'a-eur', path: 'assets:wise:eur' },
  { id: 'a-chequing', path: 'assets:chequing' },
]

const GROUPS = [
  { id: 'g-house', name: 'Household', categories: [{ id: 'c-food', name: 'Groceries' }] },
] as ManifestContext['groups']

function ctx(overrides: Partial<ManifestContext> = {}): ManifestContext {
  return {
    accounts: ACCOUNTS,
    groups: GROUPS,
    currencyAccounts: { EUR: 'a-eur' },
    fromAccountId: 'a-chequing',
    isMultiCurrency: false,
    defaultCurrency: 'CAD',
    uncategorizedAccountId: 'a-uncat',
    rulesCreated: [],
    accountsCreated: [],
    ...overrides,
  }
}

function tx(amount: string, date = '2026-06-10', extra: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return { isTransfer: false, date, amount, description: 'X', ...extra } as ParsedTransaction
}

function row(overrides: Partial<RowState> = {}): RowState {
  return {
    offsetAccountId: 'a-groceries',
    conversionAccountId: 'a-chequing',
    feeAccountId: 'a-chequing',
    skipped: false,
    groupId: null,
    categoryId: null,
    kind: 'spend',
    expenseAccountId: '',
    source: 'none',
    ...overrides,
  }
}

describe('per-destination totals', () => {
  it('groups rows by where the money lands and sums them', () => {
    const txs = [tx('-40.00'), tx('-12.50'), tx('-8.00')]
    const rows = [row(), row(), row({ offsetAccountId: 'a-transport' })]

    const m = buildManifest(txs, rows, 0, ctx())

    expect(m.committedCount).toBe(3)
    expect(m.lines).toHaveLength(2)
    expect(m.lines[0]).toMatchObject({ label: 'expenses:groceries', count: 2, currency: 'CAD' })
    expect(m.lines[0].total).toBeCloseTo(52.5, 2)
    expect(m.lines[1]).toMatchObject({ label: 'expenses:transport', count: 1 })
  })

  it('orders by count descending so the biggest line leads', () => {
    const txs = [tx('-1.00'), tx('-1.00'), tx('-1.00')]
    const rows = [row({ offsetAccountId: 'a-transport' }), row(), row()]

    expect(buildManifest(txs, rows, 0, ctx()).lines.map((l) => l.label)).toEqual([
      'expenses:groceries',
      'expenses:transport',
    ])
  })

  it('flags the uncategorized destination — the line this whole step exists to catch', () => {
    const m = buildManifest([tx('-40.00')], [row({ offsetAccountId: 'a-uncat' })], 0, ctx())
    expect(m.lines[0].isUncategorized).toBe(true)
  })

  it('does not flag a normal expense account', () => {
    const m = buildManifest([tx('-40.00')], [row()], 0, ctx())
    expect(m.lines[0].isUncategorized).toBe(false)
  })

  it('refuses a total when one destination is fed by several currencies', () => {
    const txs = [tx('-40.00', '2026-06-01', { currency: 'CAD' }), tx('-40.00', '2026-06-02', { currency: 'EUR' })]
    const m = buildManifest(txs, [row(), row()], 0, ctx())

    expect(m.lines[0].count).toBe(2)
    expect(m.lines[0].total).toBeNull()
    expect(m.lines[0].currency).toBeNull()
  })

  it('labels a Fish Pie split by group and category', () => {
    const m = buildManifest([tx('-40.00')], [row({ groupId: 'g-house', categoryId: 'c-food' })], 0, ctx())
    expect(m.lines[0].label).toBe('Household · Groceries')
  })

  it('labels an uncategorized split by group alone', () => {
    const m = buildManifest([tx('-40.00')], [row({ groupId: 'g-house', categoryId: null })], 0, ctx())
    expect(m.lines[0].label).toBe('Household')
  })

  it('keeps two categories of one group on separate lines', () => {
    const rows = [
      row({ groupId: 'g-house', categoryId: 'c-food' }),
      row({ groupId: 'g-house', categoryId: null }),
    ]
    expect(buildManifest([tx('-1.00'), tx('-1.00')], rows, 0, ctx()).lines).toHaveLength(2)
  })

  it('sends a cross-currency spend to its expense account', () => {
    const spend = {
      isTransfer: true,
      date: '2026-06-01',
      sourceAmount: '-17.29',
      sourceCurrency: 'USD',
      targetAmount: '360.00',
      targetCurrency: 'CZK',
    } as ParsedTransaction
    const m = buildManifest([spend], [row({ kind: 'spend', expenseAccountId: 'a-transport' })], 0, ctx())

    expect(m.lines[0].label).toBe('expenses:transport')
    expect(m.lines[0].total).toBeCloseTo(360, 2)
    expect(m.lines[0].currency).toBe('CZK')
  })

  it('sends a convert-and-park to the mapped currency account', () => {
    const convert = {
      isTransfer: true,
      date: '2026-06-01',
      sourceAmount: '-120.00',
      sourceCurrency: 'CAD',
      targetAmount: '80.00',
      targetCurrency: 'EUR',
    } as ParsedTransaction
    const m = buildManifest([convert], [row({ kind: 'transfer' })], 0, ctx())
    expect(m.lines[0].label).toBe('assets:wise:eur')
  })

  it('names an unassigned destination rather than showing a blank line', () => {
    const m = buildManifest([tx('-40.00')], [row({ offsetAccountId: '' })], 0, ctx())
    expect(m.lines[0].label).toBe('No account assigned')
  })
})

describe('skipped rows', () => {
  it('separates duplicates from manual skips', () => {
    const txs = [tx('-1.00'), tx('-1.00'), tx('-1.00')]
    const rows = [
      row({ skipped: true, possibleDuplicate: { transactionId: 't', date: '2026-06-01', amount: '-1.00', currency: 'CAD' } }),
      row({ skipped: true }),
      row(),
    ]

    const m = buildManifest(txs, rows, 0, ctx())
    expect(m.skippedDuplicates).toBe(1)
    expect(m.skippedManual).toBe(1)
    expect(m.committedCount).toBe(1)
  })

  it('leaves skipped rows out of the destination totals entirely', () => {
    const m = buildManifest([tx('-40.00'), tx('-40.00')], [row(), row({ skipped: true })], 0, ctx())
    expect(m.lines[0].count).toBe(1)
    expect(m.lines[0].total).toBeCloseTo(40, 2)
  })
})

describe('date range', () => {
  it('spans the committed rows', () => {
    const txs = [tx('-1.00', '2026-06-03'), tx('-1.00', '2026-06-30'), tx('-1.00', '2026-06-15')]
    const m = buildManifest(txs, [row(), row(), row()], 0, ctx())
    expect(m.dateRange).toEqual({ from: '2026-06-03', to: '2026-06-30' })
  })

  it('excludes skipped rows at both ends', () => {
    // A leading week of skipped duplicates would otherwise land the user on a screen whose
    // top is entirely rows they did not just import.
    const txs = [tx('-1.00', '2026-06-01'), tx('-1.00', '2026-06-10'), tx('-1.00', '2026-06-30')]
    const rows = [row({ skipped: true }), row(), row({ skipped: true })]

    expect(buildManifest(txs, rows, 0, ctx()).dateRange).toEqual({ from: '2026-06-10', to: '2026-06-10' })
  })

  it('is null when everything is skipped', () => {
    expect(buildManifest([tx('-1.00')], [row({ skipped: true })], 0, ctx()).dateRange).toBeNull()
  })

  it('reads the date part of an ISO timestamp', () => {
    const m = buildManifest([tx('-1.00', '2026-06-03T08:00:00Z')], [row()], 0, ctx())
    expect(m.dateRange).toEqual({ from: '2026-06-03', to: '2026-06-03' })
  })
})

describe('incomplete rows', () => {
  it('names exactly the rows that would block the commit', () => {
    const txs = [tx('-1.00'), tx('-1.00'), tx('-1.00')]
    const rows = [row(), row({ offsetAccountId: '' }), row()]

    expect(buildManifest(txs, rows, 0, ctx()).incomplete).toEqual([1])
  })

  it('does not count a skipped row as incomplete', () => {
    const rows = [row({ offsetAccountId: '', skipped: true })]
    expect(buildManifest([tx('-1.00')], rows, 0, ctx()).incomplete).toEqual([])
  })

  it('does not count a split row missing an offset account', () => {
    // A Fish Pie split derives its offset from the group, so it needs none.
    const rows = [row({ offsetAccountId: '', groupId: 'g-house' })]
    expect(buildManifest([tx('-1.00')], rows, 0, ctx()).incomplete).toEqual([])
  })
})

describe('pass-through counts', () => {
  it('carries parse errors, rules and accounts created', () => {
    const m = buildManifest(
      [tx('-1.00')],
      [row()],
      4,
      ctx({ rulesCreated: ['LOBLAWS', 'BILLA'], accountsCreated: ['assets:wise:jpy'] }),
    )
    expect(m.parseErrors).toBe(4)
    expect(m.rulesCreated).toEqual(['LOBLAWS', 'BILLA'])
    expect(m.accountsCreated).toEqual(['assets:wise:jpy'])
  })

  it('handles an empty preview', () => {
    const m = buildManifest([], [], 0, ctx())
    expect(m.committedCount).toBe(0)
    expect(m.lines).toEqual([])
    expect(m.dateRange).toBeNull()
  })
})
