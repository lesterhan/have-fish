import { describe, expect, it } from 'bun:test'
import {
  type JournalAccount,
  type JournalTransaction,
  journalAccountName,
  journalDescription,
  serializeJournal,
} from './journal'

// No database and no hledger here: the serializer is text in, text out. `hledger.test.ts`
// is where a real hledger reads the output; this file pins the text itself.

const HEADER = [
  '; Exported from have-fish. Every amount is as stored; conversions balance through the',
  '; conversion account rather than with @ prices. Read it with: hledger -f <file> balance',
].join('\n')

const tx = (
  date: string,
  description: string | null,
  ...legs: [string, string, string][]
): JournalTransaction => ({
  date,
  description,
  postings: legs.map(([accountPath, amount, currency]) => ({ accountPath, amount, currency })),
})

const journal = (accounts: JournalAccount[], transactions: JournalTransaction[]) =>
  serializeJournal({ accounts, transactions })

describe('serializeJournal', () => {
  it('writes only the header for an empty ledger', () => {
    expect(journal([], [])).toBe(`${HEADER}\n`)
  })

  it('writes a single-currency ledger in full', () => {
    const text = journal(
      [
        { path: 'expenses:food', type: 'expense' },
        { path: 'assets:bank', type: 'asset' },
      ],
      [
        tx(
          '2026-01-05',
          'Groceries',
          ['assets:bank', '-42.10', 'CAD'],
          ['expenses:food', '42.10', 'CAD'],
        ),
      ],
    )
    expect(text).toBe(
      [
        HEADER,
        '',
        'commodity 1000.00 CAD',
        '',
        'account assets:bank  ; type:A',
        'account expenses:food  ; type:X',
        '',
        '2026-01-05 Groceries',
        '    assets:bank  -42.10 CAD',
        '    expenses:food  42.10 CAD',
        '',
      ].join('\n'),
    )
  })

  it('writes a conversion as its stored legs, with no cost notation', () => {
    // The epic's key finding: each currency balances through the conversion account.
    const text = journal(
      [],
      [
        tx(
          '2026-06-28',
          'Lunch in Paris',
          ['assets:wise:cad', '-100.00', 'CAD'],
          ['equity:conversion', '100.00', 'CAD'],
          ['equity:conversion', '-68.00', 'EUR'],
          ['expenses:food', '68.00', 'EUR'],
        ),
      ],
    )
    expect(text).toContain(
      [
        '2026-06-28 Lunch in Paris',
        '    assets:wise:cad  -100.00 CAD',
        '    equity:conversion  100.00 CAD',
        '    equity:conversion  -68.00 EUR',
        '    expenses:food  68.00 EUR',
      ].join('\n'),
    )
    expect(text.split('\n').filter((l) => l.startsWith('    ') && l.includes('@'))).toEqual([])
    expect(text).toContain('commodity 1000.00 CAD\ncommodity 1000.00 EUR')
  })

  it('writes a fee leg like any other posting', () => {
    const text = journal(
      [],
      [
        tx(
          '2026-02-01',
          'Transfer',
          ['assets:wise:cad', '-101.50', 'CAD'],
          ['expenses:fees', '1.50', 'CAD'],
          ['assets:bank', '100.00', 'CAD'],
        ),
      ],
    )
    expect(text).toContain('    expenses:fees  1.50 CAD')
  })

  it('declares every type by its hledger code', () => {
    const text = journal(
      [
        { path: 'a', type: 'asset' },
        { path: 'b', type: 'cash' },
        { path: 'c', type: 'liability' },
        { path: 'd', type: 'equity' },
        { path: 'e', type: 'income' },
        { path: 'f', type: 'expense' },
        { path: 'g', type: 'conversion' },
      ],
      [],
    )
    for (const line of [
      'account a  ; type:A',
      'account b  ; type:C',
      'account c  ; type:L',
      'account d  ; type:E',
      'account e  ; type:R',
      'account f  ; type:X',
      'account g  ; type:V',
    ]) {
      expect(text).toContain(`${line}\n`)
    }
  })

  it('declares an account with no type bare, rather than leaving it out', () => {
    // hledger's strict check wants every account declared; a bare one says "no type".
    const text = journal(
      [
        { path: '储蓄:中国银行', type: 'asset' },
        { path: '花钱:房租', type: null },
      ],
      [],
    )
    expect(text).toContain('account 储蓄:中国银行  ; type:A\naccount 花钱:房租\n')
  })

  it('sorts declarations by path, by code point, whatever order they came in', () => {
    const text = journal(
      [
        { path: 'expenses:b', type: 'expense' },
        { path: 'Assets', type: 'asset' },
        { path: 'expenses:a', type: 'expense' },
      ],
      [],
    )
    const declarations = text.split('\n').filter((l) => l.startsWith('account '))
    expect(declarations).toEqual([
      'account Assets  ; type:A',
      'account expenses:a  ; type:X',
      'account expenses:b  ; type:X',
    ])
  })

  it('sorts transactions by date and keeps the given order within a day', () => {
    const text = journal(
      [],
      [
        tx('2026-03-02', 'third', ['a', '1', 'CAD'], ['b', '-1', 'CAD']),
        tx('2026-03-01', 'first', ['a', '1', 'CAD'], ['b', '-1', 'CAD']),
        tx('2026-03-02', 'fourth', ['a', '1', 'CAD'], ['b', '-1', 'CAD']),
        tx('2026-03-01', 'second', ['a', '1', 'CAD'], ['b', '-1', 'CAD']),
      ],
    )
    const headers = text.split('\n').filter((l) => /^\d{4}-/.test(l))
    expect(headers).toEqual([
      '2026-03-01 first',
      '2026-03-01 second',
      '2026-03-02 third',
      '2026-03-02 fourth',
    ])
  })

  it('writes every amount with two decimals, and zero without a sign', () => {
    const text = journal(
      [],
      [tx('2026-01-01', 'x', ['a', '5', 'CAD'], ['b', '-5.0', 'CAD'], ['c', '-0.00', 'CAD'])],
    )
    expect(text).toContain('    a  5.00 CAD\n    b  -5.00 CAD\n    c  0.00 CAD\n')
  })

  it('writes the date alone when there is no description', () => {
    for (const description of [null, '', '   ']) {
      const text = journal(
        [],
        [tx('2026-01-01', description, ['a', '1', 'CAD'], ['b', '-1', 'CAD'])],
      )
      expect(text).toContain('\n2026-01-01\n    a  1.00 CAD')
    }
  })

  it('declares an account once when two paths read the same', () => {
    const text = journal(
      [
        { path: 'assets:my  bank', type: 'asset' },
        { path: 'assets:my bank', type: 'asset' },
      ],
      [],
    )
    expect(text.split('\n').filter((l) => l.startsWith('account '))).toEqual([
      'account assets:my bank  ; type:A',
    ])
  })
})

describe('hostile text', () => {
  it('never lets a description start a new line', () => {
    const text = journal(
      [],
      [
        tx(
          '2026-01-01',
          'Coffee\ninclude /etc/passwd\r\naccount x\u2028y',
          ['a', '1', 'CAD'],
          ['b', '-1', 'CAD'],
        ),
      ],
    )
    expect(text).toContain('2026-01-01 Coffee include /etc/passwd  account x y\n')
    expect(text.split('\n').some((l) => l.startsWith('include'))).toBe(false)
  })

  it('never lets an account path start a new line', () => {
    const path = 'expenses:x\ninclude /etc/passwd'
    const text = journal(
      [{ path, type: 'expense' }],
      [tx('2026-01-01', 'x', [path, '1', 'CAD'], ['b', '-1', 'CAD'])],
    )
    expect(text.split('\n').some((l) => l.startsWith('include'))).toBe(false)
    expect(text).toContain('account expenses:x include /etc/passwd  ; type:X')
    expect(text).toContain('    expenses:x include /etc/passwd  1.00 CAD')
  })

  it('keeps a spreadsheet formula as text: the journal is not a CSV', () => {
    // hledger reads these as the description, as the harness shows; M10's formula guard is
    // for a CSV export, which the app does not have.
    for (const description of ['=SUM(A1)', '+1 555', '-refund', '@home']) {
      const text = journal(
        [],
        [tx('2026-01-01', description, ['a', '1', 'CAD'], ['b', '-1', 'CAD'])],
      )
      expect(text).toContain(`\n2026-01-01 ${description}\n`)
    }
  })

  it('puts a leading status mark or parenthesis after an empty code', () => {
    for (const description of ['* starred', '! flagged', '(123) cheque']) {
      const text = journal(
        [],
        [tx('2026-01-01', description, ['a', '1', 'CAD'], ['b', '-1', 'CAD'])],
      )
      expect(text).toContain(`\n2026-01-01 () ${description}\n`)
    }
    // Not when the character is anywhere but the start.
    const text = journal(
      [],
      [tx('2026-01-01', 'Tip (cash) *', ['a', '1', 'CAD'], ['b', '-1', 'CAD'])],
    )
    expect(text).toContain('\n2026-01-01 Tip (cash) *\n')
  })
})

describe('journalDescription', () => {
  it('turns control characters into spaces and trims', () => {
    expect(journalDescription(' a\tb\nc\u0000d\u007f ')).toBe('a b c d')
  })

  it('makes a semicolon full-width, so hledger does not read a comment', () => {
    expect(journalDescription('Coffee; date:2020-01-01')).toBe('Coffee； date:2020-01-01')
  })

  it('leaves everything else alone', () => {
    const text = '午饭 🍜 | Payee (note) =x +y -z @w * ! "quoted" \'single\''
    expect(journalDescription(text)).toBe(text)
  })

  it('reads null as empty', () => {
    expect(journalDescription(null)).toBe('')
  })
})

describe('journalAccountName', () => {
  it('leaves an ordinary path alone, including a semicolon and non-Latin text', () => {
    for (const path of ['assets:bank:chequing', '储蓄:中国银行', 'assets:a;b', 'x:(y)', 'a b:c']) {
      expect(journalAccountName(path)).toBe(path)
    }
  })

  it('collapses whitespace, which would otherwise end the name', () => {
    expect(journalAccountName('assets:my  bank')).toBe('assets:my bank')
    expect(journalAccountName('assets:tab\there')).toBe('assets:tab here')
    expect(journalAccountName('assets:nbsp\u00a0\u00a0here')).toBe('assets:nbsp here')
    expect(journalAccountName('assets:bell\u0007ring')).toBe('assets:bell ring')
  })

  it('makes a leading bracket full-width, which would otherwise make a virtual posting', () => {
    expect(journalAccountName('(weird)')).toBe('（weird)')
    expect(journalAccountName('[brackets]:x')).toBe('［brackets]:x')
  })
})
