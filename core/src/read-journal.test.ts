import { describe, expect, it } from 'vitest'
import { readJournal } from './read-journal'

const journal = (...lines: string[]) => `${lines.join('\n')}\n`

// What the hosted app exports: a spend, a transfer, pay, a starting balance, a conversion, and
// an amount past the cent.
const FOUR = journal(
  '; Exported from have-fish. Every amount is as stored; conversions balance through the',
  '; conversion account rather than with @ prices. Read it with: hledger -f <file> balance',
  '',
  'commodity 1000.00 CAD',
  'commodity 1000.00 EUR',
  '',
  'account assets:bank:chequing  ; type:A',
  'account equity:adjustments  ; type:E',
  'account equity:conversions  ; type:V',
  'account expenses:food  ; type:X',
  'account income:salary  ; type:R',
  'account liabilities:visa  ; type:L',
  '',
  '2026-01-01 Starting balance',
  '    assets:bank:chequing  3200.00 CAD',
  '    equity:adjustments  -3200.00 CAD',
  '',
  '2026-01-05 Groceries',
  '    assets:bank:chequing  -42.10 CAD',
  '    expenses:food  42.10 CAD',
  '',
  '2026-01-05 Card payment',
  '    assets:bank:chequing  -300.00 CAD',
  '    liabilities:visa  300.00 CAD',
  '',
  '2026-01-15 Pay',
  '    income:salary  -2500.00 CAD',
  '    assets:bank:chequing  2500.00 CAD',
  '',
  '2026-02-01 Lunch in Paris',
  '    assets:bank:chequing  -100.00 CAD',
  '    equity:conversions  100.00 CAD',
  '    equity:conversions  -68.00 EUR',
  '    expenses:food  68.00 EUR',
  '',
  '2026-02-03 Bakery',
  '    assets:bank:chequing  -10.00 CAD',
  '    expenses:food  10.004 CAD',
)

const SPEND = ['    assets:bank  -42.10 CAD', '    expenses:food  42.10 CAD']

describe('readJournal', () => {
  it('reads nothing from an empty text', () => {
    expect(readJournal('')).toEqual({ accounts: [], entries: [], skipped: [] })
  })

  it('reads nothing from comments, blanks and commodity lines', () => {
    const header = FOUR.split('\n').slice(0, 6).join('\n')
    expect(readJournal(header)).toEqual({ accounts: [], entries: [], skipped: [] })
  })

  it('reads an account directive with its type, and one without', () => {
    expect(
      readJournal(journal('account assets:bank  ; type:A', 'account 花钱:房租')).accounts,
    ).toEqual([
      { line: 1, name: 'assets:bank', type: 'A' },
      { line: 2, name: '花钱:房租', type: null },
    ])
  })

  it('reads an entry, its date, description and postings', () => {
    expect(readJournal(journal('2026-01-05 Groceries', ...SPEND)).entries).toEqual([
      {
        line: 1,
        date: '2026-01-05',
        description: 'Groceries',
        postings: [
          { account: 'assets:bank', amount: '-42.10', currency: 'CAD' },
          { account: 'expenses:food', amount: '42.10', currency: 'CAD' },
        ],
      },
    ])
  })

  it('ends an account name at two spaces, keeping its single ones', () => {
    const read = readJournal(
      journal('2026-01-05 x', '    储蓄:中国 银行  -5.00 CAD', '\texpenses:food  5.00 CAD'),
    )
    expect(read.entries[0]?.postings.map((p) => p.account)).toEqual([
      '储蓄:中国 银行',
      'expenses:food',
    ])
  })

  it('keeps each amount as written, never parsed, rounded or reformatted', () => {
    const read = readJournal(
      journal(
        '2026-01-05 x',
        '    expenses:food  10.004 CAD',
        '    expenses:food  -0.00 CAD',
        '    expenses:food  5 CAD',
        '    assets:bank  -3200.00 CAD',
      ),
    )
    expect(read.entries[0]?.postings.map((p) => p.amount)).toEqual([
      '10.004',
      '-0.00',
      '5',
      '-3200.00',
    ])
  })

  it("takes off only the hosted app's one leading empty code", () => {
    const read = readJournal(
      journal(
        '2026-01-01 () * starred',
        ...SPEND,
        '',
        '2026-01-01 () () x',
        ...SPEND,
        '',
        '2026-01-01 Tip (cash) *',
        ...SPEND,
      ),
    )
    expect(read.entries.map((e) => e.description)).toEqual(['* starred', '() x', 'Tip (cash) *'])
  })

  it('reads a date with no description as an empty description', () => {
    expect(readJournal(journal('2026-01-01', ...SPEND)).entries[0]?.description).toBe('')
  })

  it('keeps the entries in the order written', () => {
    const read = readJournal(
      journal('2026-01-05 Groceries', ...SPEND, '', '2026-01-05 Card payment', ...SPEND),
    )
    expect(read.entries.map((e) => [e.line, e.description])).toEqual([
      [1, 'Groceries'],
      [5, 'Card payment'],
    ])
  })

  it('numbers lines from 1, counting comments and blanks', () => {
    const read = readJournal(FOUR)
    expect(read.entries.map((e) => e.line)).toEqual([14, 18, 22, 26, 30, 36])
    expect(read.accounts.map((a) => a.line)).toEqual([7, 8, 9, 10, 11, 12])
  })

  it('leaves out an entry with a price, at its date line', () => {
    const read = readJournal(
      journal(
        '2026-02-01 Lunch',
        '    expenses:food  10.00 EUR @ 1.50 CAD',
        '    assets:bank  -15.00 CAD',
        '',
        '2026-02-02 Dinner',
        '    expenses:food  10.00 EUR @@ 15.00 CAD',
        '    assets:bank  -15.00 CAD',
      ),
    )
    expect(read.entries).toEqual([])
    expect(read.skipped).toEqual([
      { line: 1, why: 'price' },
      { line: 5, why: 'price' },
    ])
  })

  it('leaves out an entry with a posting it cannot read', () => {
    const unread = [
      '    expenses:food',
      '    expenses:food  1,000.00 CAD',
      '    expenses:food  $10.00',
      '    expenses:food 1.00 CAD',
    ]
    const read = readJournal(
      journal(...unread.flatMap((p) => ['2026-01-01 x', p, '    assets:bank  -1.00 CAD', ''])),
    )
    expect(read.entries).toEqual([])
    expect(read.skipped).toEqual([
      { line: 1, why: 'unread' },
      { line: 5, why: 'unread' },
      { line: 9, why: 'unread' },
      { line: 13, why: 'unread' },
    ])
  })

  it("says why by the entry's first line it cannot read, and the rest is not stray", () => {
    const read = readJournal(
      journal(
        '2026-01-01 x',
        '    assets:bank  -1.00 CAD',
        '    expenses:food  1.00 EUR @ 1.50 CAD',
        '    expenses:food',
      ),
    )
    expect(read.skipped).toEqual([{ line: 1, why: 'price' }])
  })

  it('counts a line outside any entry as stray', () => {
    const read = readJournal(
      journal('include other.journal', '2026/01/05 x', '', '    expenses:food  1.00 CAD'),
    )
    expect(read.entries).toEqual([])
    expect(read.skipped).toEqual([
      { line: 1, why: 'stray' },
      { line: 2, why: 'stray' },
      { line: 4, why: 'stray' },
    ])
  })

  it('ends an entry at a directive with no blank before it', () => {
    const read = readJournal(journal('2026-01-05 Groceries', ...SPEND, 'account expenses:food'))
    expect(read.entries).toHaveLength(1)
    expect(read.entries[0]?.postings).toHaveLength(2)
    expect(read.accounts).toEqual([{ line: 4, name: 'expenses:food', type: null }])
  })

  it('reads an entry with no postings, for the ledger to refuse', () => {
    expect(readJournal(journal('2026-01-05 Nothing', '', '2026-01-06 Also')).entries).toEqual([
      { line: 1, date: '2026-01-05', description: 'Nothing', postings: [] },
      { line: 3, date: '2026-01-06', description: 'Also', postings: [] },
    ])
  })

  it('checks the form of a date, leaving the day to the ledger', () => {
    const read = readJournal(journal('2026-13-01 x', ...SPEND))
    expect(read.entries[0]?.date).toBe('2026-13-01')
  })

  it('reads CR LF as LF', () => {
    expect(readJournal(FOUR.replaceAll('\n', '\r\n'))).toEqual(readJournal(FOUR))
  })

  it('reads the last entry at the end of the text, with no newline after it', () => {
    expect(readJournal(FOUR.slice(0, -1))).toEqual(readJournal(FOUR))
  })
})
