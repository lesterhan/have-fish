import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Papa from 'papaparse'
import * as money from '../money'
import { HLEDGER_TYPE_CODE, type StoredAccountType } from '../postings/account-type'
import { clearDatabase, createTestUser, request } from '../test-utils'
import { journalAccountName, journalDescription } from './journal'

// The acceptance test for the export (#283): a real hledger reads the file and reports the
// balances the app reports, to the cent, for a ledger built the way the app builds one.
//
// It needs an `hledger` binary on the PATH. Without one the suite is skipped, so the rest
// of the tests still run on a machine that has never heard of hledger; CI installs it and
// sets REQUIRE_HLEDGER=1, under which a missing binary fails instead of skipping.

const HLEDGER = Bun.which('hledger')
if (!HLEDGER && process.env.REQUIRE_HLEDGER === '1') {
  throw new Error('REQUIRE_HLEDGER=1, but there is no hledger binary on the PATH')
}

/** Runs hledger on `file` and returns what it printed, failing with what it said if it failed. */
function hledger(file: string, ...args: string[]): string {
  if (!HLEDGER) throw new Error('no hledger')
  // hledger reads the file in the locale's encoding, and a CI shell's may not be UTF-8.
  const env = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
  const run = Bun.spawnSync([HLEDGER, '-f', file, ...args], { env })
  if (run.exitCode !== 0) {
    throw new Error(`hledger ${args.join(' ')} exited ${run.exitCode}:\n${run.stderr.toString()}`)
  }
  return run.stdout.toString()
}

function csv(text: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(text.trim(), { header: true }).data
}

// A seeded generator, so the bulk of the fixture is the same ledger on every run.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Leg = { account: string; amount: string; currency: string }
type Entry = { date: string; description: string | null; legs: Leg[] }

// Accounts by path, with the override each one carries, if any. The hostile paths are all
// ones the accounts API accepts today.
const ACCOUNTS: [string, StoredAccountType?][] = [
  ['assets:bank:chequing'],
  ['assets:wise:cad'],
  ['assets:wise:eur'],
  ['assets:wise:usd'],
  ['assets:cash:jpy', 'cash'],
  ['liabilities:visa'],
  ['equity:conversion', 'conversion'],
  ['equity:opening'],
  ['income:salary'],
  ['expenses:food'],
  ['expenses:rent'],
  ['expenses:fees'],
  ['expenses:travel'],
  // An atypical root with an override, a child that inherits it, and one with neither.
  ['储蓄', 'asset'],
  ['储蓄:中国银行'],
  ['花钱:房租'],
  // Paths hledger would misread if they were written as they are.
  ['(weird)'],
  ['[brackets]:x'],
  ['assets:my  bank'],
  ['expenses:tab\there'],
  ['expenses:x\ninclude /etc/passwd'],
  ['assets:a;b'],
]

const HOSTILE_DESCRIPTIONS = [
  '=HYPERLINK("http://example.com","click")',
  '+1 555 0100',
  '-refund',
  '@mention',
  'Coffee; date:2020-01-01 tag:x',
  '* starred',
  '! flagged',
  '(123) cheque',
  'line one\ninclude /etc/passwd',
  '\ttabbed\t',
  '午饭 🍜 | payee',
  '',
  null,
]

function canonicalEntries(): Entry[] {
  const leg = (account: string, amount: string, currency = 'CAD'): Leg => ({
    account,
    amount,
    currency,
  })
  return [
    {
      date: '2025-01-01',
      description: 'Opening balance',
      legs: [leg('assets:bank:chequing', '5000.00'), leg('equity:opening', '-5000.00')],
    },
    {
      date: '2025-01-01',
      description: 'A large opening, to check nothing is grouped or rounded',
      legs: [leg('assets:my  bank', '1234567890.12'), leg('equity:opening', '-1234567890.12')],
    },
    {
      date: '2025-01-15',
      description: 'Salary',
      legs: [leg('assets:bank:chequing', '3200.00'), leg('income:salary', '-3200.00')],
    },
    {
      date: '2025-01-16',
      description: 'Split groceries on the card',
      legs: [
        leg('liabilities:visa', '-120.37'),
        leg('expenses:food', '100.00'),
        leg('expenses:travel', '20.37'),
      ],
    },
    {
      // A Wise conversion with a fee: CAD and EUR each balance through the conversion account.
      date: '2025-02-01',
      description: 'Convert CAD to EUR',
      legs: [
        leg('assets:wise:cad', '-101.50'),
        leg('expenses:fees', '1.50'),
        leg('equity:conversion', '100.00'),
        leg('equity:conversion', '-68.12', 'EUR'),
        leg('assets:wise:eur', '68.12', 'EUR'),
      ],
    },
    {
      date: '2025-02-02',
      description: 'Lunch in Paris',
      legs: [leg('assets:wise:eur', '-12.34', 'EUR'), leg('expenses:food', '12.34', 'EUR')],
    },
    {
      // No fee, so `--infer-costs` can pair the legs into a cost.
      date: '2025-03-01',
      description: 'Cash for Tokyo',
      legs: [
        leg('assets:bank:chequing', '-150.00'),
        leg('equity:conversion', '150.00'),
        leg('equity:conversion', '-16500.00', 'JPY'),
        leg('assets:cash:jpy', '16500.00', 'JPY'),
      ],
    },
    {
      date: '2025-03-02',
      description: 'Ramen',
      legs: [leg('assets:cash:jpy', '-1234.00', 'JPY'), leg('expenses:food', '1234.00', 'JPY')],
    },
    {
      date: '2025-03-15',
      description: 'Pay the card',
      legs: [leg('assets:bank:chequing', '-120.37'), leg('liabilities:visa', '120.37')],
    },
    {
      date: '2025-04-01',
      description: '存款',
      legs: [leg('储蓄:中国银行', '8888.88', 'CNY'), leg('equity:opening', '-8888.88', 'CNY')],
    },
    {
      date: '2025-04-02',
      description: '房租',
      legs: [leg('储蓄:中国银行', '-3000.00', 'CNY'), leg('花钱:房租', '3000.00', 'CNY')],
    },
    {
      // A parent with postings of its own, next to its child's.
      date: '2025-04-03',
      description: 'Interest on the parent',
      legs: [leg('储蓄', '0.01', 'CNY'), leg('equity:opening', '-0.01', 'CNY')],
    },
    // Hostile text, on hostile paths.
    ...HOSTILE_DESCRIPTIONS.map((description, i) => ({
      date: `2025-05-${String(i + 1).padStart(2, '0')}`,
      description,
      legs: [
        leg(i % 2 ? '(weird)' : '[brackets]:x', `-${i + 1}.01`),
        leg(i % 3 ? 'expenses:tab\there' : 'expenses:x\ninclude /etc/passwd', `${i}.00`),
        leg('assets:a;b', '1.01'),
      ],
    })),
  ]
}

// Four hundred transactions across 2025-06 to 2026-05 in four currencies: spends, income,
// three-way splits and conversions with and without a fee, every amount a random number of
// cents. Enough volume for a rounding or sign slip to show up in some account.
function generatedEntries(): Entry[] {
  const random = mulberry32(283)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  const cents = (max: number) => 1 + Math.floor(random() * max)
  const amount = (c: number) => money.format(c)
  const wallets = [
    ['assets:wise:cad', 'CAD'],
    ['assets:wise:eur', 'EUR'],
    ['assets:wise:usd', 'USD'],
    ['assets:cash:jpy', 'JPY'],
    ['liabilities:visa', 'CAD'],
  ] as const
  const expenses = ['expenses:food', 'expenses:rent', 'expenses:travel', '花钱:房租', '(weird)']

  const entries: Entry[] = []
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(2025, 5, 1) + Math.floor(random() * 365) * 86_400_000)
    const date = day.toISOString().slice(0, 10)
    const kind = random()
    if (kind < 0.5) {
      const [wallet, currency] = pick(wallets)
      const c = cents(50_000)
      entries.push({
        date,
        description: `Spend ${i}`,
        legs: [
          { account: wallet, amount: amount(-c), currency },
          { account: pick(expenses), amount: amount(c), currency },
        ],
      })
    } else if (kind < 0.65) {
      const c = cents(500_000)
      entries.push({
        date,
        description: `Income ${i}`,
        legs: [
          { account: 'assets:bank:chequing', amount: amount(c), currency: 'CAD' },
          { account: 'income:salary', amount: amount(-c), currency: 'CAD' },
        ],
      })
    } else if (kind < 0.8) {
      const [wallet, currency] = pick(wallets)
      const a = cents(10_000)
      const b = cents(10_000)
      const c = cents(10_000)
      entries.push({
        date,
        description: `Split ${i}`,
        legs: [
          { account: wallet, amount: amount(-(a + b + c)), currency },
          { account: 'expenses:food', amount: amount(a), currency },
          { account: 'expenses:travel', amount: amount(b), currency },
          { account: '储蓄:中国银行', amount: amount(c), currency },
        ],
      })
    } else {
      const [src, srcCcy] = pick(wallets.slice(0, 4))
      const [dst, dstCcy] = pick(wallets.slice(0, 4).filter(([, ccy]) => ccy !== srcCcy))
      const out = cents(200_000)
      const fee = random() < 0.5 ? cents(500) : 0
      const got = cents(200_000)
      const legs: Leg[] = [
        { account: src, amount: amount(-(out + fee)), currency: srcCcy },
        { account: 'equity:conversion', amount: amount(out), currency: srcCcy },
        { account: 'equity:conversion', amount: amount(-got), currency: dstCcy },
        { account: dst, amount: amount(got), currency: dstCcy },
      ]
      if (fee) legs.push({ account: 'expenses:fees', amount: amount(fee), currency: srcCcy })
      entries.push({ date, description: `Convert ${i}`, legs })
    }
  }
  return entries
}

type AppBalance = {
  path: string
  resolvedType: StoredAccountType | null
  balances: { currency: string; amount: string }[]
}

describe.skipIf(!HLEDGER)('hledger reads the export', () => {
  let dir: string
  let file: string
  let text: string
  let entries: Entry[]
  let app: AppBalance[]

  beforeAll(async () => {
    await clearDatabase()
    const cookie = await createTestUser()
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }

    const ids = new Map<string, string>()
    for (const [path, type] of ACCOUNTS) {
      const res = await request('/api/accounts', {
        method: 'POST',
        headers,
        body: JSON.stringify(type ? { path, type } : { path }),
      })
      if (res.status !== 201) throw new Error(`account ${path}: ${await res.text()}`)
      ids.set(path, ((await res.json()) as { id: string }).id)
    }

    const toBody = (e: Entry) => ({
      date: e.date,
      description: e.description,
      postings: e.legs.map((l) => ({
        accountId: ids.get(l.account),
        amount: l.amount,
        currency: l.currency,
      })),
    })
    entries = [...canonicalEntries(), ...generatedEntries()]
    const created = await request('/api/transactions/bulk', {
      method: 'POST',
      headers,
      body: JSON.stringify({ transactions: entries.map(toBody) }),
    })
    if (created.status !== 201) throw new Error(`bulk: ${await created.text()}`)

    // One deleted transaction, which neither side may count.
    const deleted = await request('/api/transactions', {
      method: 'POST',
      headers,
      body: JSON.stringify(
        toBody({
          date: '2025-06-15',
          description: 'Deleted',
          legs: [
            { account: 'assets:bank:chequing', amount: '-999.99', currency: 'CAD' },
            { account: 'expenses:food', amount: '999.99', currency: 'CAD' },
          ],
        }),
      ),
    })
    const deletedId = ((await deleted.json()) as { id: string }).id
    await request(`/api/transactions/${deletedId}`, { method: 'DELETE', headers })

    text = await (await request('/api/export/journal', { headers })).text()
    dir = mkdtempSync(join(tmpdir(), 'have-fish-hledger-'))
    file = join(dir, 'export.journal')
    writeFileSync(file, text)

    // Every account the app knows, by the name the journal gives it: the typed ones, and
    // the ones with no type, which only `include=unfiled` lists.
    const typed = (await (
      await request(`/api/accounts/balances?types=${Object.keys(HLEDGER_TYPE_CODE).join(',')}`, {
        headers,
      })
    ).json()) as AppBalance[]
    const unfiled = (
      (await (
        await request('/api/accounts/balances?include=unfiled', { headers })
      ).json()) as AppBalance[]
    ).filter((a) => a.resolvedType === null)
    app = [...typed, ...unfiled]
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('passes hledger’s strict check: balanced, every account and currency declared', () => {
    hledger(file, 'check', '--strict')
  })

  it('reports every balance the app reports, to the cent, and nothing else', () => {
    const nonZero = (amount: string) => money.parse(amount) !== 0

    const expected = new Map<string, string>()
    for (const a of app) {
      for (const b of a.balances) {
        if (nonZero(b.amount)) expected.set(`${journalAccountName(a.path)} ${b.currency}`, b.amount)
      }
    }

    const reported = new Map<string, string>()
    const rows = csv(hledger(file, 'balance', '--flat', '-N', '-O', 'csv', '--layout=tidy'))
    for (const row of rows) {
      const { account, commodity, value } = row as {
        account: string
        commodity: string
        value: string
      }
      if (nonZero(value)) reported.set(`${account} ${commodity}`, money.format(money.cents(value)))
    }

    expect(reported.size).toBeGreaterThan(30)
    expect(Object.fromEntries(reported)).toEqual(Object.fromEntries(expected))
  })

  it('reads every live transaction, on its date, with its description whole', () => {
    const rows = csv(hledger(file, 'print', '-O', 'csv'))
    const read = new Map<string, Record<string, string>>()
    for (const row of rows) if (row.txnidx) read.set(row.txnidx, row)

    const got = [...read.values()]
    // hledger's CSV has a row per posting, so a transaction with none would be invisible
    // there; the file's own headers are counted too.
    expect(text.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2}/.test(l))).toHaveLength(
      entries.length,
    )
    expect(got).toHaveLength(entries.length)
    // Nothing the parser took for a status, a code or a comment.
    expect(got.filter((r) => r.status || r.code || r.comment)).toEqual([])
    const lines = (list: string[]) => [...list].sort()
    expect(lines(got.map((r) => `${r.date} ${r.description}`))).toEqual(
      lines(entries.map((e) => `${e.date} ${journalDescription(e.description)}`)),
    )

    const descriptions = new Set(got.map((r) => r.description))
    for (const whole of [
      '=HYPERLINK("http://example.com","click")',
      '* starred',
      '! flagged',
      '(123) cheque',
      'Coffee； date:2020-01-01 tag:x',
      'line one include /etc/passwd',
      '午饭 🍜 | payee',
    ]) {
      expect(descriptions).toContain(whole)
    }
    expect(text.split('\n').filter((l) => l.startsWith('include'))).toEqual([])
  })

  it('gives every account the type the app resolves', () => {
    const declared = new Map<string, string>()
    for (const line of hledger(file, 'accounts', '--types').split('\n')) {
      const match = /^(.*\S)\s+; type: ?([A-Z]?)$/.exec(line)
      if (match?.[1] !== undefined) declared.set(match[1], match[2] ?? '')
    }
    for (const a of app) {
      const code = a.resolvedType ? HLEDGER_TYPE_CODE[a.resolvedType] : ''
      expect([journalAccountName(a.path), declared.get(journalAccountName(a.path))]).toEqual([
        journalAccountName(a.path),
        code,
      ])
    }
    expect(declared.get('储蓄:中国银行')).toBe('A')
    expect(declared.get('assets:cash:jpy')).toBe('C')
    expect(declared.get('equity:conversion')).toBe('V')
    expect(declared.get('花钱:房租')).toBe('')
  })

  it('rebuilds a conversion’s cost from the legs when asked', () => {
    // hledger's own reading of the conversion account: `--infer-costs` pairs a conversion's
    // legs with the posting that matches and writes the cost. Run over the whole file, so a
    // conversion it can't pair (one with a fee) is shown not to be an error either.
    const printed = hledger(file, 'print', '--infer-costs')
    expect(printed).toMatch(/assets:bank:chequing\s+-150\.00 CAD @@ 16500\.00 JPY/)
  })
})
