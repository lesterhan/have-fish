import { describe, expect, it } from 'bun:test'
import type { ImportRowKind } from '../errors'
import { validatePostings } from '../ledger/validate'
import {
  type CommitRow,
  checkRows,
  type ImportRowInput,
  namedAccountIds,
  type PlannedRow,
  planRows,
  type SplitContext,
  takesSplit,
} from './commit-plan'

// No database here: the plan is rows in, transactions out.

const DATE = '2026-03-01T00:00:00.000Z'

const regularRow: ImportRowInput = {
  isTransfer: false,
  date: DATE,
  amount: '-42.50',
  description: 'Grocery run',
  offsetAccountId: 'offset',
}

const transferRow: ImportRowInput = {
  isTransfer: true,
  date: DATE,
  description: 'To GBP',
  sourceAmount: '-200.00',
  sourceCurrency: 'CAD',
  targetAmount: '107.90',
  targetCurrency: 'GBP',
  feeAmount: '0.96',
  feeCurrency: 'CAD',
  sourceAccountId: 'wise-cad',
  targetAccountId: 'wise-gbp',
  conversionAccountId: 'conversion',
  feeAccountId: 'fees',
}

const spendRow: ImportRowInput = {
  isTransfer: 'cross-currency-spend',
  date: DATE,
  description: 'Café in Lyon',
  sourceAmount: '-15.20',
  sourceCurrency: 'CAD',
  targetAmount: '10.00',
  targetCurrency: 'EUR',
  sourceAccountId: 'wise-cad',
  expenseAccountId: 'dining',
  conversionAccountId: 'conversion',
}

const sameCurrencyRow: ImportRowInput = {
  isTransfer: 'same-currency',
  date: DATE,
  description: 'From savings',
  amount: '199.69',
  feeAmount: '0.62',
  currency: 'CAD',
  targetAccountId: 'wise-cad',
  sourceAccountId: 'bank',
  feeAccountId: 'fees',
}

const split: SplitContext = {
  groupId: 'group',
  categoryId: null,
  groupAccountId: 'receivable',
  payerExpenseAccountId: 'my-dining',
  payerShareRatio: 0.5,
}

function checked(rows: ImportRowInput[], splitRows: number[] = []) {
  const result = checkRows(rows, { accountId: 'import-account', splitRows: new Set(splitRows) })
  if (!result.ok) throw new Error(`rows refused: ${JSON.stringify(result.failure)}`)
  return result.value
}

function plan(rows: CommitRow[], splits = new Map<number, SplitContext>(), accountId = 'import') {
  let n = 0
  return planRows(rows, {
    accountId,
    defaultCurrency: 'CAD',
    splits,
    newId: () => `tx-${n++}`,
  })
}

function only(planned: PlannedRow[]): PlannedRow {
  const [row, ...rest] = planned
  if (!row || rest.length > 0) throw new Error(`expected one planned row, got ${planned.length}`)
  return row
}

function legs(row: PlannedRow) {
  return row.transaction.postings.map((p) => [p.accountId, p.amount, p.currency])
}

describe('checkRows', () => {
  it('passes a row of each kind that names every account it needs', () => {
    const result = checkRows([regularRow, transferRow, spendRow, sameCurrencyRow], {
      accountId: 'import-account',
      splitRows: new Set(),
    })
    expect(result.ok).toBe(true)
  })

  const cases: [string, ImportRowInput, ImportRowKind, string][] = [
    ['regular', { ...regularRow, offsetAccountId: undefined }, 'regular', 'offsetAccountId'],
    ['transfer', { ...transferRow, sourceAccountId: undefined }, 'transfer', 'sourceAccountId'],
    ['transfer', { ...transferRow, targetAccountId: '' }, 'transfer', 'targetAccountId'],
    ['transfer', { ...transferRow, conversionAccountId: '' }, 'transfer', 'conversionAccountId'],
    ['transfer', { ...transferRow, feeAccountId: undefined }, 'transfer', 'feeAccountId'],
    ['spend', { ...spendRow, sourceAccountId: '' }, 'cross-currency-spend', 'sourceAccountId'],
    ['spend', { ...spendRow, expenseAccountId: '' }, 'cross-currency-spend', 'expenseAccountId'],
    [
      'spend',
      { ...spendRow, conversionAccountId: '' },
      'cross-currency-spend',
      'conversionAccountId',
    ],
    [
      'spend with a fee',
      { ...spendRow, feeAmount: '0.50' },
      'cross-currency-spend',
      'feeAccountId',
    ],
    [
      'same-currency',
      { ...sameCurrencyRow, targetAccountId: '' },
      'same-currency-transfer',
      'targetAccountId',
    ],
    [
      'same-currency',
      { ...sameCurrencyRow, sourceAccountId: '' },
      'same-currency-transfer',
      'sourceAccountId',
    ],
    [
      'same-currency',
      { ...sameCurrencyRow, feeAccountId: '' },
      'same-currency-transfer',
      'feeAccountId',
    ],
  ]
  for (const [name, row, rowKind, field] of cases) {
    it(`refuses a ${name} row with no ${field}`, () => {
      const result = checkRows([row], { accountId: 'import-account', splitRows: new Set() })
      expect(result).toEqual({
        ok: false,
        failure: { error: 'IMPORT_ROW_MISSING_ACCOUNT', detail: { rowKind, field } },
      })
    })
  }

  it('lets a regular row fall back to the import account, and refuses when there is none', () => {
    expect(checkRows([regularRow], { accountId: 'import-account', splitRows: new Set() }).ok).toBe(
      true,
    )
    expect(checkRows([regularRow], { accountId: null, splitRows: new Set() })).toEqual({
      ok: false,
      failure: {
        error: 'IMPORT_ROW_MISSING_ACCOUNT',
        detail: { rowKind: 'regular', field: 'sourceAccountId' },
      },
    })
  })

  it('needs no offset on a split regular row, and no target on a split transfer', () => {
    const rows = [
      { ...regularRow, offsetAccountId: undefined },
      { ...transferRow, targetAccountId: undefined },
    ]
    expect(checkRows(rows, { accountId: 'a', splitRows: new Set([0, 1]) }).ok).toBe(true)
    expect(checkRows(rows, { accountId: 'a', splitRows: new Set([1]) }).ok).toBe(false)
  })

  it('answers the first row that fails', () => {
    const result = checkRows(
      [regularRow, { ...transferRow, feeAccountId: '' }, { ...spendRow, sourceAccountId: '' }],
      { accountId: 'a', splitRows: new Set() },
    )
    expect(!result.ok && result.failure).toEqual({
      error: 'IMPORT_ROW_MISSING_ACCOUNT',
      detail: { rowKind: 'transfer', field: 'feeAccountId' },
    })
  })
})

describe('namedAccountIds', () => {
  it('collects every account id the request names, skipping the empty ones', () => {
    expect(namedAccountIds('import', [regularRow, { ...spendRow, sourceAccountId: '' }])).toEqual([
      'import',
      'offset',
      'conversion',
      'dining',
    ])
    expect(namedAccountIds(null, [])).toEqual([])
  })
})

describe('planRows', () => {
  it('mints one id per row, in order', () => {
    const planned = plan(checked([regularRow, sameCurrencyRow]))
    expect(planned.map((p) => [p.index, p.transaction.id])).toEqual([
      [0, 'tx-0'],
      [1, 'tx-1'],
    ])
  })

  it('writes a regular row as the source against its offset, in the default currency', () => {
    const row = only(plan(checked([regularRow])))
    expect(row.transaction).toMatchObject({ date: DATE, description: 'Grocery run' })
    expect(legs(row)).toEqual([
      ['import', '-42.50', 'CAD'],
      ['offset', '42.50', 'CAD'],
    ])
    expect(row.groupExpense).toBeUndefined()
  })

  it("uses the row's own source account and currency when it has them", () => {
    const row = only(
      plan(checked([{ ...regularRow, sourceAccountId: 'wise-usd', currency: 'USD' }])),
    )
    expect(legs(row)).toEqual([
      ['wise-usd', '-42.50', 'USD'],
      ['offset', '42.50', 'USD'],
    ])
  })

  it('bridges a transfer through the conversion account, with the fee as the third leg', () => {
    expect(legs(only(plan(checked([transferRow]))))).toEqual([
      ['wise-cad', '-200.00', 'CAD'],
      ['conversion', '199.04', 'CAD'],
      ['fees', '0.96', 'CAD'],
      ['conversion', '-107.90', 'GBP'],
      ['wise-gbp', '107.90', 'GBP'],
    ])
  })

  it('leaves out the fee leg when the fee is missing or zero', () => {
    for (const feeAmount of [undefined, '0.00']) {
      const row = only(plan(checked([{ ...transferRow, feeAmount }])))
      expect(row.transaction.postings.map((p) => p.accountId)).not.toContain('fees')
      expect(row.transaction.postings).toHaveLength(4)
    }
  })

  it('writes a same-currency transfer as net received plus fee against the gross', () => {
    expect(legs(only(plan(checked([sameCurrencyRow]))))).toEqual([
      ['wise-cad', '199.69', 'CAD'],
      ['fees', '0.62', 'CAD'],
      ['bank', '-200.31', 'CAD'],
    ])
  })

  it('writes a cross-currency spend to the expense account, never an asset', () => {
    const row = only(plan(checked([spendRow])))
    const accounts = row.transaction.postings.map((p) => p.accountId)
    expect(accounts).toContain('dining')
    expect(accounts).not.toContain('wise-gbp')
  })

  it('writes a split row through the Fish Pie legs, and plans its group expense', () => {
    const planned = plan(
      checked([{ ...regularRow, offsetAccountId: undefined }, regularRow], [0]),
      new Map([[0, split]]),
    )
    const [shared, own] = planned
    expect(shared && legs(shared)).toEqual([
      ['import', '-42.50', 'CAD'],
      ['receivable', '21.25', 'CAD'],
      ['my-dining', '21.25', 'CAD'],
    ])
    expect(shared?.groupExpense).toEqual({
      groupId: 'group',
      categoryId: null,
      description: 'Grocery run',
      amount: '42.50',
      currency: 'CAD',
      date: '2026-03-01',
    })
    expect(own?.groupExpense).toBeUndefined()
  })

  it('splits the target side of a transfer and of a same-currency transfer', () => {
    const [transfer, same] = plan(
      checked([transferRow, sameCurrencyRow]),
      new Map([
        [0, split],
        [1, split],
      ]),
    )
    expect(transfer?.groupExpense).toMatchObject({ amount: '107.90', currency: 'GBP' })
    expect(transfer?.transaction.postings.map((p) => p.accountId)).not.toContain('wise-gbp')
    expect(same?.groupExpense).toMatchObject({ amount: '199.69', currency: 'CAD' })
    expect(same?.transaction.postings.map((p) => p.accountId)).toContain('receivable')
  })

  it('ignores a split on a cross-currency spend', () => {
    expect(takesSplit(spendRow as CommitRow)).toBe(false)
    const row = only(plan(checked([spendRow]), new Map([[0, split]])))
    expect(row.groupExpense).toBeUndefined()
    expect(row.transaction.postings.map((p) => p.accountId)).not.toContain('receivable')
  })

  it('plans legs that balance, for every kind, split or not', () => {
    const rows = checked([regularRow, transferRow, spendRow, sameCurrencyRow])
    const splits = new Map([0, 1, 3].map((i) => [i, { ...split, payerShareRatio: 1 / 3 }]))
    for (const planned of [plan(rows), plan(rows, splits)]) {
      for (const p of planned) {
        expect(validatePostings(p.transaction.postings, p.index)).toEqual({
          ok: true,
          value: undefined,
        })
      }
    }
  })

  // An empty sourceAccountId passes checkRows when the import has an account of its own, and
  // then falls back to nothing, because `??` keeps the empty string. The commit has always
  // answered 500 for it; this pins the behaviour until #458 fixes it.
  it('throws on a regular row whose source is an empty string', () => {
    const rows = checked([{ ...regularRow, sourceAccountId: '' }])
    expect(() => plan(rows)).toThrow('import row 0 has no source account')
  })
})
