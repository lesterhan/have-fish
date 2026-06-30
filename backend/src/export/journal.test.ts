import { describe, expect, test } from 'bun:test'
import { serializeJournal, type JournalData } from './journal'
import { DEFAULT_ROOTS } from '../postings/account-type'

// All tests use DEFAULT_ROOTS (assets/liabilities/equity/expenses/income) unless a case is
// specifically about a custom root.
const roots = DEFAULT_ROOTS

describe('serializeJournal', () => {
  test('empty data set yields an empty string', () => {
    const data: JournalData = { accounts: [], transactions: [] }
    expect(serializeJournal(data, roots)).toBe('')
  })

  test('single-currency transaction with inferred account types', () => {
    const data: JournalData = {
      accounts: [
        { path: 'assets:cash', type: null },
        { path: 'expenses:food', type: null },
      ],
      transactions: [
        {
          date: new Date('2026-06-28T12:00:00.000Z'),
          description: 'Groceries',
          postings: [
            { accountPath: 'assets:cash', amount: '-42.50', currency: 'CAD' },
            { accountPath: 'expenses:food', amount: '42.50', currency: 'CAD' },
          ],
        },
      ],
    }
    expect(serializeJournal(data, roots)).toBe(
      [
        'account assets:cash  ; type:A',
        'account expenses:food  ; type:X',
        '',
        '2026-06-28 Groceries',
        '    assets:cash  -42.50 CAD',
        '    expenses:food  42.50 CAD',
        '',
      ].join('\n'),
    )
  })

  test('multi-currency Wise conversion emits verbatim per-commodity legs (no cost notation)', () => {
    const data: JournalData = {
      accounts: [
        { path: 'assets:wise:cad', type: null },
        { path: 'equity:conversion', type: null },
        { path: 'expenses:food', type: null },
      ],
      transactions: [
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          description: 'Lunch in Paris',
          postings: [
            { accountPath: 'assets:wise:cad', amount: '-100.00', currency: 'CAD' },
            { accountPath: 'equity:conversion', amount: '100.00', currency: 'CAD' },
            { accountPath: 'equity:conversion', amount: '-150.00', currency: 'EUR' },
            { accountPath: 'expenses:food', amount: '150.00', currency: 'EUR' },
          ],
        },
      ],
    }
    const out = serializeJournal(data, roots)
    expect(out).toContain('    assets:wise:cad  -100.00 CAD')
    expect(out).toContain('    equity:conversion  100.00 CAD')
    expect(out).toContain('    equity:conversion  -150.00 EUR')
    expect(out).toContain('    expenses:food  150.00 EUR')
    // No cost notation anywhere.
    expect(out).not.toContain('@')
  })

  test('fee leg is emitted like any other posting', () => {
    const data: JournalData = {
      accounts: [
        { path: 'assets:wise:cad', type: null },
        { path: 'expenses:fees:wise', type: null },
        { path: 'assets:wise:usd', type: null },
      ],
      transactions: [
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          description: 'Transfer with fee',
          postings: [
            { accountPath: 'assets:wise:cad', amount: '-100.00', currency: 'CAD' },
            { accountPath: 'expenses:fees:wise', amount: '2.00', currency: 'CAD' },
            { accountPath: 'assets:wise:usd', amount: '98.00', currency: 'CAD' },
          ],
        },
      ],
    }
    expect(serializeJournal(data, roots)).toContain('    expenses:fees:wise  2.00 CAD')
  })

  test('atypical-root account with a stored type gets a directive', () => {
    const data: JournalData = {
      accounts: [
        { path: '储蓄:中国银行', type: 'asset' },
        { path: '花钱:房租', type: 'expense' },
      ],
      transactions: [],
    }
    expect(serializeJournal(data, roots)).toBe(
      ['account 储蓄:中国银行  ; type:A', 'account 花钱:房租  ; type:X', ''].join('\n'),
    )
  })

  test('account with null type and atypical root gets no directive', () => {
    const data: JournalData = {
      accounts: [{ path: '储蓄:中国银行', type: null }],
      transactions: [],
    }
    // Nothing resolves -> no directives -> empty output.
    expect(serializeJournal(data, roots)).toBe('')
  })

  test('income resolves to R, distinct from equity (E)', () => {
    const data: JournalData = {
      accounts: [
        { path: 'income:salary', type: null },
        { path: 'equity:opening', type: null },
      ],
      transactions: [],
    }
    expect(serializeJournal(data, roots)).toBe(
      ['account equity:opening  ; type:E', 'account income:salary  ; type:R', ''].join('\n'),
    )
  })

  test('stored cash and conversion subtypes emit C and V codes', () => {
    const data: JournalData = {
      accounts: [
        { path: 'assets:wallet', type: 'cash' },
        { path: 'equity:conversion', type: 'conversion' },
      ],
      transactions: [],
    }
    expect(serializeJournal(data, roots)).toBe(
      ['account assets:wallet  ; type:C', 'account equity:conversion  ; type:V', ''].join('\n'),
    )
  })

  test('stored override wins over path inference', () => {
    const data: JournalData = {
      // Path would infer asset, but the stored override forces liability.
      accounts: [{ path: 'assets:loan-i-owe', type: 'liability' }],
      transactions: [],
    }
    expect(serializeJournal(data, roots)).toContain('account assets:loan-i-owe  ; type:L')
  })

  test('all liability/equity/expense/income/asset codes', () => {
    const data: JournalData = {
      accounts: [
        { path: 'assets:a', type: null },
        { path: 'liabilities:l', type: null },
        { path: 'equity:e', type: null },
        { path: 'income:i', type: null },
        { path: 'expenses:x', type: null },
      ],
      transactions: [],
    }
    const out = serializeJournal(data, roots)
    expect(out).toContain('account assets:a  ; type:A')
    expect(out).toContain('account liabilities:l  ; type:L')
    expect(out).toContain('account equity:e  ; type:E')
    expect(out).toContain('account income:i  ; type:R')
    expect(out).toContain('account expenses:x  ; type:X')
  })

  test('account directives are sorted by path', () => {
    const data: JournalData = {
      accounts: [
        { path: 'expenses:food', type: null },
        { path: 'assets:cash', type: null },
        { path: 'assets:bank', type: null },
      ],
      transactions: [],
    }
    expect(serializeJournal(data, roots)).toBe(
      [
        'account assets:bank  ; type:A',
        'account assets:cash  ; type:A',
        'account expenses:food  ; type:X',
        '',
      ].join('\n'),
    )
  })

  test('transactions are sorted by date, blank-line separated', () => {
    const data: JournalData = {
      accounts: [],
      transactions: [
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          description: 'Second',
          postings: [{ accountPath: 'expenses:food', amount: '1.00', currency: 'CAD' }],
        },
        {
          date: new Date('2026-06-27T00:00:00.000Z'),
          description: 'First',
          postings: [{ accountPath: 'expenses:food', amount: '2.00', currency: 'CAD' }],
        },
      ],
    }
    expect(serializeJournal(data, roots)).toBe(
      [
        '2026-06-27 First',
        '    expenses:food  2.00 CAD',
        '',
        '2026-06-28 Second',
        '    expenses:food  1.00 CAD',
        '',
      ].join('\n'),
    )
  })

  test('same-date transactions preserve input order (stable sort)', () => {
    const data: JournalData = {
      accounts: [],
      transactions: [
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          description: 'Alpha',
          postings: [{ accountPath: 'expenses:food', amount: '1.00', currency: 'CAD' }],
        },
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          description: 'Beta',
          postings: [{ accountPath: 'expenses:food', amount: '2.00', currency: 'CAD' }],
        },
      ],
    }
    const out = serializeJournal(data, roots)
    expect(out.indexOf('Alpha')).toBeLessThan(out.indexOf('Beta'))
  })

  test('date is formatted as the UTC calendar day', () => {
    const data: JournalData = {
      accounts: [],
      transactions: [
        {
          // 23:30 UTC -> still 2026-06-28 UTC (no local shift to the 29th).
          date: new Date('2026-06-28T23:30:00.000Z'),
          description: 'Late',
          postings: [{ accountPath: 'expenses:food', amount: '1.00', currency: 'CAD' }],
        },
      ],
    }
    expect(serializeJournal(data, roots)).toContain('2026-06-28 Late')
  })

  test('null description emits date alone', () => {
    const data: JournalData = {
      accounts: [],
      transactions: [
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          description: null,
          postings: [{ accountPath: 'expenses:food', amount: '1.00', currency: 'CAD' }],
        },
      ],
    }
    expect(serializeJournal(data, roots)).toBe(
      ['2026-06-28', '    expenses:food  1.00 CAD', ''].join('\n'),
    )
  })

  test('newlines in description are collapsed to spaces', () => {
    const data: JournalData = {
      accounts: [],
      transactions: [
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          description: 'line one\nline two\r\nline three',
          postings: [{ accountPath: 'expenses:food', amount: '1.00', currency: 'CAD' }],
        },
      ],
    }
    expect(serializeJournal(data, roots)).toContain('2026-06-28 line one line two line three')
  })

  test('custom roots classify atypical paths via inference', () => {
    const customRoots = {
      assetsRootPath: '储蓄',
      liabilitiesRootPath: 'liabilities',
      equityRootPath: 'equity',
      expensesRootPath: '花钱',
      incomeRootPath: 'income',
    }
    const data: JournalData = {
      accounts: [
        { path: '储蓄:中国银行', type: null },
        { path: '花钱:房租', type: null },
      ],
      transactions: [],
    }
    expect(serializeJournal(data, customRoots)).toBe(
      ['account 储蓄:中国银行  ; type:A', 'account 花钱:房租  ; type:X', ''].join('\n'),
    )
  })
})
