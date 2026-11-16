import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountKind } from '@have-fish/core/account-kind'
import { cents } from '@have-fish/core/money'
import { readJournal } from '@have-fish/core/read-journal'
import { shapeOf } from '@have-fish/core/shapes'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { documentsOf, type JournalReport, journalLines, type LeftOut, seedJournal } from './journal'
import { open, realFolders, sandbox, type Where } from './sandbox'

const NOW = Date.UTC(2026, 10, 9, 3)
const DEVICE = '0123456789abcdef'

const journal = (...lines: string[]) => `${lines.join('\n')}\n`

const FOUR_LINES = [
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
]
// What the hosted app exports: a starting balance, a spend, a transfer, pay, a conversion, and
// an amount past the cent.
const FOUR = journal(...FOUR_LINES)

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** What documentsOf is given: a fixed device and time, and ids in order from id(1). */
function made() {
  let n = 0
  return { deviceId: DEVICE, nowMs: NOW, newId: () => id(++n) }
}

const documentsOfText = (text: string) => documentsOf(readJournal(text), made())

const anEntry = (date: string, ...postings: string[]) => [`${date} x`, ...postings, '']
const SPEND = ['    assets:bank  -1.00 CAD', '    expenses:food  1.00 CAD']

/** A sandbox under a temp folder, deleted when the test finishes. */
function aSandbox(): Where {
  const base = mkdtempSync(join(tmpdir(), 'havefish-journal-'))
  onTestFinished(() => rmSync(base, { recursive: true, force: true }))
  return sandbox('journal', base)
}

/** Runs `sql` on the ledger file `where` holds. */
function query<T>(where: Where, sql: string): T[] {
  const ledger = open(where, NOW)
  try {
    return ledger.db.prepare<[], T>(sql).all()
  } finally {
    ledger.close()
  }
}

const liveTransactions = (where: Where) =>
  query<{ n: number }>(where, 'SELECT count(*) AS n FROM transactions WHERE deletedAt IS NULL')[0]
    ?.n

const FOUR_REPORT: JournalReport = {
  entries: {
    read: 6,
    written: 4,
    leftOut: [{ line: 30, why: 'currency' }],
    refused: [{ line: 36, code: 'AMOUNT_INVALID' }],
  },
  accounts: { read: 6, written: 6, leftOut: [], refused: [] },
  stray: [],
}

const EMPTY = { read: 0, written: 0, leftOut: [], refused: [] }

describe('documentsOf', () => {
  test('makes an account document from a directive', () => {
    expect(documentsOfText(FOUR).accounts[0]).toEqual({
      line: 7,
      doc: {
        type: 'account',
        id: id(1),
        path: 'assets:bank:chequing',
        kind: 'bank',
        currency: null,
        deletedAt: null,
        origin: { source: 'manual', createdAt: NOW, deviceId: DEVICE },
      },
    })
  })

  test('gives each account the kind of its root, and of its type where that changes it', () => {
    expect(documentsOfText(FOUR).accounts.map((a) => [a.doc.path, a.doc.kind])).toEqual([
      ['assets:bank:chequing', 'bank'],
      ['equity:adjustments', 'opening'],
      ['equity:conversions', 'conversion'],
      ['expenses:food', 'category'],
      ['income:salary', 'income'],
      ['liabilities:visa', 'card'],
    ])
  })

  test('changes the kind by a type only under its own root', () => {
    const text = journal(
      'account assets:cash  ; type:C',
      'account assets:wallet',
      'account equity:opening',
      'account expenses:odd  ; type:C',
    )
    expect(documentsOfText(text).accounts.map((a) => a.doc.kind)).toEqual([
      'cash',
      'bank',
      'opening',
      'category',
    ])
  })

  test('leaves out an account under no root the ledger knows', () => {
    const docs = documentsOfText(journal('account 储蓄:中国银行', 'account Assets:bank'))
    expect(docs.accounts).toEqual([])
    expect(docs.accountsLeftOut).toEqual([
      { line: 1, why: 'root' },
      { line: 2, why: 'root' },
    ])
  })

  test('makes an account a posting names with no directive, at its first entry', () => {
    const docs = documentsOfText(
      journal(
        'account assets:bank  ; type:A',
        '',
        '2026-01-05 Rent',
        '    assets:bank  -900.00 CAD',
        '    expenses:rent  900.00 CAD',
      ),
    )
    expect(docs.accounts.map((a) => [a.line, a.doc.path, a.doc.kind])).toEqual([
      [1, 'assets:bank', 'bank'],
      [3, 'expenses:rent', 'category'],
    ])
    expect(docs.transactions[0]?.doc.postings.map((p) => p.accountId)).toEqual(
      docs.accounts.map((a) => a.doc.id),
    )
  })

  test('makes a spend with its amounts as written, at noon on its date', () => {
    expect(documentsOfText(FOUR).transactions[1]).toEqual({
      line: 18,
      doc: {
        type: 'transaction',
        id: id(8),
        date: '2026-01-05',
        description: 'Groceries',
        postings: [
          { accountId: id(1), amount: '-42.10', currency: 'CAD' },
          { accountId: id(4), amount: '42.10', currency: 'CAD' },
        ],
        deletedAt: null,
        origin: { source: 'manual', createdAt: Date.UTC(2026, 0, 5, 12), deviceId: DEVICE },
      },
    })
  })

  test('makes a starting balance, a spend, a transfer and pay the shapes try year writes', () => {
    const docs = documentsOfText(FOUR)
    const kinds = new Map<string, AccountKind>(docs.accounts.map((a) => [a.doc.id, a.doc.kind]))
    const shapes = docs.transactions
      .filter((t) => [14, 18, 22, 26].includes(t.line))
      .map((t) => {
        const legs = t.doc.postings.map((p) => ({ ...p, cents: cents(p.amount) }))
        return shapeOf(legs, (accountId) => kinds.get(accountId)).shape
      })
    expect(shapes).toEqual(['start', 'spend', 'transfer', 'income'])
  })

  test("keeps a day's entries in the journal's order, a second apart", () => {
    const docs = documentsOfText(FOUR)
    const createdAt = (line: number) =>
      docs.transactions.find((t) => t.line === line)?.doc.origin.createdAt
    expect([createdAt(18), createdAt(22)]).toEqual([
      Date.UTC(2026, 0, 5, 12),
      Date.UTC(2026, 0, 5, 12, 0, 1),
    ])
  })

  test('makes an entry dated today, whose noon is still to come, now', () => {
    const docs = documentsOfText(journal(...anEntry('2026-11-09', ...SPEND)))
    expect(docs.transactions[0]?.doc.origin.createdAt).toBe(NOW)
  })

  test('makes an entry on a day with no time now, for the ledger to judge the date', () => {
    const docs = documentsOfText(
      journal(...anEntry('2026-13-01', ...SPEND), ...anEntry('1969-12-31', ...SPEND)),
    )
    expect(docs.transactions.map((t) => t.doc.origin.createdAt)).toEqual([NOW, NOW])
  })

  test('leaves out an entry with any posting in another currency, whole', () => {
    const four = documentsOfText(FOUR)
    expect(four.entriesLeftOut).toEqual([{ line: 30, why: 'currency' }])
    expect(four.transactions.map((t) => t.line)).not.toContain(30)

    const euros = documentsOfText(
      journal('2026-02-01 x', '    assets:bank  -10.00 EUR', '    expenses:food  10.00 EUR'),
    )
    expect(euros.entriesLeftOut).toEqual([{ line: 1, why: 'currency' }])
  })

  test('leaves out an entry posting to an account left out', () => {
    const docs = documentsOfText(
      journal(
        'account 储蓄:中国银行',
        '',
        '2026-01-05 Rent',
        '    储蓄:中国银行  -900.00 CAD',
        '    expenses:rent  900.00 CAD',
      ),
    )
    expect(docs.transactions).toEqual([])
    expect(docs.entriesLeftOut).toEqual([{ line: 3, why: 'account' }])
  })

  test('asks about the currency before the accounts', () => {
    const docs = documentsOfText(
      journal('2026-02-01 x', '    储蓄:中国银行  -10.00 EUR', '    expenses:food  10.00 EUR'),
    )
    expect(docs.entriesLeftOut).toEqual([{ line: 1, why: 'currency' }])
  })

  test("lists the reader's entries left out with its own, by line", () => {
    const docs = documentsOfText(
      journal(
        ...anEntry(
          '2026-02-01',
          '    expenses:food  10.00 EUR @ 1.50 CAD',
          '    assets:bank  -15.00 CAD',
        ),
        ...anEntry('2026-02-02', '    expenses:food  10.00 EUR', '    assets:bank  -10.00 EUR'),
        ...anEntry('2026-02-03', '    expenses:food', '    assets:bank  -1.00 CAD'),
      ),
    )
    expect(docs.entriesLeftOut).toEqual([
      { line: 1, why: 'price' },
      { line: 5, why: 'currency' },
      { line: 9, why: 'unread' },
    ])
  })
})

describe('seedJournal', () => {
  test('writes what it can, and says what it left out and what the ledger refused', () => {
    expect(seedJournal(aSandbox(), FOUR, { nowMs: NOW })).toEqual(FOUR_REPORT)
  })

  test('writes the entries whole: none in part', () => {
    const where = aSandbox()
    seedJournal(where, FOUR, { nowMs: NOW })
    expect(liveTransactions(where)).toBe(4)
    expect(query(where, 'SELECT id FROM accounts')).toHaveLength(6)
  })

  test('leaves a ledger that balances in each currency', () => {
    const where = aSandbox()
    seedJournal(where, FOUR, { nowMs: NOW })
    expect(
      query(where, 'SELECT currency, sum(amountCents) AS total FROM postings GROUP BY currency'),
    ).toEqual([{ currency: 'CAD', total: 0 }])
  })

  test('lists each entry the ledger refuses with its line and code', () => {
    const text = journal(
      ...FOUR_LINES.slice(0, 13),
      '2026-13-01 Odd',
      '    assets:bank:chequing  -1.00 CAD',
      '    expenses:food  1.00 CAD',
      '',
      '2026-03-02 Empty',
      '',
      '2026-03-03 Off',
      '    assets:bank:chequing  -10.00 CAD',
      '    expenses:food  10.01 CAD',
    )
    expect(seedJournal(aSandbox(), text, { nowMs: NOW }).entries.refused).toEqual([
      { line: 14, code: 'DATE_INVALID' },
      { line: 18, code: 'TOO_FEW_POSTINGS' },
      { line: 20, code: 'POSTINGS_DO_NOT_BALANCE' },
    ])
  })

  const BAD_PATH = ['account assets:a::b', 'account expenses:food']

  test('lists each account the ledger refuses with its line and code', () => {
    const report = seedJournal(aSandbox(), journal(...BAD_PATH), { nowMs: NOW })
    expect(report.accounts).toEqual({
      read: 2,
      written: 1,
      leftOut: [],
      refused: [{ line: 1, code: 'PATH_INVALID' }],
    })
  })

  test('refuses the entries posting to an account the ledger refused', () => {
    const text = journal(
      ...BAD_PATH,
      '',
      '2026-01-05 x',
      '    assets:a::b  -1.00 CAD',
      '    expenses:food  1.00 CAD',
    )
    expect(seedJournal(aSandbox(), text, { nowMs: NOW }).entries.refused).toEqual([
      { line: 4, code: 'ACCOUNT_NOT_FOUND' },
    ])
  })

  test('names a refusal by its own line, first in its slice as last', () => {
    expect(seedJournal(aSandbox(), FOUR, { nowMs: NOW, batch: 2 })).toEqual(FOUR_REPORT)
  })

  test('tells its progress after each slice, accounts and entries together', () => {
    const progress = vi.fn()
    seedJournal(aSandbox(), FOUR, { nowMs: NOW, batch: 5, progress })
    expect(progress.mock.calls).toEqual([[5], [6], [10]])
  })

  test('counts a line outside any entry, and reads nothing from it', () => {
    const report = seedJournal(aSandbox(), journal('include other.journal'), { nowMs: NOW })
    expect(report).toEqual({ entries: EMPTY, accounts: EMPTY, stray: [1] })
  })

  test('throws the last ledger away and makes it again', () => {
    const where = aSandbox()
    seedJournal(where, FOUR, { nowMs: NOW })
    seedJournal(where, FOUR, { nowMs: NOW })
    expect(liveTransactions(where)).toBe(4)
  })

  test('writes only under its sandbox folder', () => {
    const home = mkdtempSync(join(tmpdir(), 'havefish-home-'))
    onTestFinished(() => rmSync(home, { recursive: true, force: true }))
    vi.stubEnv('XDG_DATA_HOME', home)
    vi.stubEnv('XDG_CONFIG_HOME', home)
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    const base = mkdtempSync(join(tmpdir(), 'havefish-journal-'))
    onTestFinished(() => rmSync(base, { recursive: true, force: true }))

    seedJournal(sandbox('journal', base), FOUR, { nowMs: NOW })

    expect(readdirSync(home)).toEqual([])
    expect(readdirSync(base)).toEqual(['journal'])
  })

  test("keeps the sandbox's folders to the owner", () => {
    const where = aSandbox()
    seedJournal(where, FOUR, { nowMs: NOW })
    for (const folder of [where.root, where.data, where.config])
      expect(statSync(folder).mode & 0o777).toBe(0o700)
  })

  test('refuses the real folders, before making any', () => {
    const home = mkdtempSync(join(tmpdir(), 'havefish-home-'))
    onTestFinished(() => rmSync(home, { recursive: true, force: true }))
    const real = realFolders({
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CONFIG_HOME: join(home, 'config'),
    })
    expect(() => seedJournal(real, FOUR, { nowMs: NOW })).toThrow(/sandbox/)
    expect(readdirSync(home)).toEqual([])
  })

  test('refuses a ledger the app has open', () => {
    const where = aSandbox()
    const config = join(where.env.XDG_CONFIG_HOME, 'have-fish')
    mkdirSync(config, { recursive: true })
    symlinkSync(`somehost-${process.pid}`, join(config, 'SingletonLock'))
    expect(() => seedJournal(where, FOUR, { nowMs: NOW })).toThrow(/has this ledger open/)
  })
})

describe('journalLines', () => {
  test('prints no description, amount or account name', () => {
    const printed = journalLines(seedJournal(aSandbox(), FOUR, { nowMs: NOW })).join('\n')
    const told = [
      'Starting balance',
      'Groceries',
      'Card payment',
      'Pay',
      'Lunch in Paris',
      'Bakery',
      '3200.00',
      '42.10',
      '300.00',
      '2500.00',
      '100.00',
      '68.00',
      '10.00',
      '10.004',
      'chequing',
      'adjustments',
      'conversions',
      'food',
      'salary',
      'visa',
    ]
    expect(told.filter((word) => printed.includes(word))).toEqual([])
  })

  test('prints what was read and written, and a line for each group with members', () => {
    expect(journalLines(FOUR_REPORT)).toEqual([
      'Read the journal: 6 entries and 6 accounts.',
      '  written: 4 entries and 6 accounts',
      '  left out, in a currency other than CAD: 1 (line 30)',
      '  refused by the ledger, AMOUNT_INVALID: 1 (line 36)',
    ])
  })

  test('prints every group, in its order', () => {
    const report: JournalReport = {
      entries: {
        read: 9,
        written: 3,
        leftOut: [
          { line: 30, why: 'currency' },
          { line: 36, why: 'currency' },
          { line: 41, why: 'price' },
          { line: 45, why: 'account' },
          { line: 49, why: 'unread' },
        ],
        refused: [{ line: 53, code: 'AMOUNT_INVALID' }],
      },
      accounts: {
        read: 4,
        written: 2,
        leftOut: [{ line: 9, why: 'root' }],
        refused: [{ line: 8, code: 'PATH_INVALID' }],
      },
      stray: [60],
    }
    expect(journalLines(report)).toEqual([
      'Read the journal: 9 entries and 4 accounts.',
      '  written: 3 entries and 2 accounts',
      '  left out, in a currency other than CAD: 2 (lines 30, 36)',
      '  left out, with a price: 1 (line 41)',
      '  left out, posting to an account left out: 1 (line 45)',
      '  left out, with a line it could not read: 1 (line 49)',
      '  account left out, not under assets, liabilities, expenses, income or equity: 1 (line 9)',
      '  refused by the ledger, AMOUNT_INVALID: 1 (line 53)',
      '  account refused by the ledger, PATH_INVALID: 1 (line 8)',
      '  not read, outside any entry: 1 (line 60)',
    ])
  })

  const entriesOnly = (entries: Partial<JournalReport['entries']>): JournalReport => ({
    entries: { ...EMPTY, ...entries },
    accounts: EMPTY,
    stray: [],
  })

  test('prints the lines of a group in ascending order', () => {
    const report = entriesOnly({
      leftOut: [
        { line: 36, why: 'currency' },
        { line: 30, why: 'currency' },
      ],
    })
    expect(journalLines(report)).toContain(
      '  left out, in a currency other than CAD: 2 (lines 30, 36)',
    )
  })

  test('prints the codes the ledger refused in alphabetical order', () => {
    const report = entriesOnly({
      refused: [
        { line: 5, code: 'TOO_FEW_POSTINGS' },
        { line: 12, code: 'DATE_INVALID' },
      ],
    })
    expect(journalLines(report).slice(2)).toEqual([
      '  refused by the ledger, DATE_INVALID: 1 (line 12)',
      '  refused by the ledger, TOO_FEW_POSTINGS: 1 (line 5)',
    ])
  })

  test('prints the first ten lines of a group, and how many more', () => {
    const report = entriesOnly({
      leftOut: Array.from({ length: 12 }, (_, i): LeftOut => ({ line: i + 1, why: 'currency' })),
    })
    expect(journalLines(report)).toContain(
      '  left out, in a currency other than CAD: 12 (lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 2 more)',
    )
  })
})
