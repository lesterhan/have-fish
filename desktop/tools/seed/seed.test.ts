import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { minorUnits } from '@have-fish/core/currencies'
import { cents } from '@have-fish/core/money'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, onTestFinished, test } from 'vitest'
import { balancesQuery } from '../../main/features/accounts/accounts'
import type { Shape } from './book'
import { seedInto, topUp } from './commands'
import { money, SHAPES } from './guide'
import { CASH, WISE_HOLDS, wise } from './moves'
import { PROFILES } from './profiles'
import { ledgerPath, open, realFolders, restore, sandbox, snap, type Where } from './sandbox'

const TODAY = '2026-11-08'
const NOW = Date.UTC(2026, 10, 9, 3)
const at = { seed: '1', today: TODAY, nowMs: NOW }

/** A sandbox under a temp folder, deleted when the test finishes. */
function aSandbox(profile = 'year'): Where {
  const base = mkdtempSync(join(tmpdir(), 'havefish-seed-'))
  onTestFinished(() => rmSync(base, { recursive: true, force: true }))
  return sandbox(profile, base)
}

function build(name: string, options = at) {
  const built = PROFILES[name]?.build({ ...options, deviceId: '0123456789abcdef' })
  if (!built) throw new Error(`${name} built nothing`)
  return built.book
}

/** What the ledger file holds: each live account's balances as the guide prints them. */
function ledgerBalances(where: Where): Map<string, string> {
  const ledger = open(where, NOW)
  try {
    const paths = new Map(
      ledger.db
        .prepare<[], { id: string; path: string }>('SELECT id, path FROM accounts')
        .all()
        .map((a) => [a.id, a.path]),
    )
    const held = new Map<string, string[]>()
    for (const { accountId, currency, cents: c } of balancesQuery(drizzle(ledger.db)).all()) {
      if (c === 0) continue
      const path = paths.get(accountId) ?? accountId
      held.set(path, [...(held.get(path) ?? []), `${currency}:${money(c, currency)}`])
    }
    return new Map(
      [...paths.values()].map((p) => [
        p,
        (held.get(p) ?? [])
          .sort()
          .map((s) => s.slice(4))
          .join(' · ') || '0',
      ]),
    )
  } finally {
    ledger.close()
  }
}

/** The guide's balance table, by account. */
function guideBalances(where: Where): Map<string, string> {
  const guide = readFileSync(join(where.root, 'GUIDE.md'), 'utf8')
  const table = guide.slice(guide.indexOf('## Every balance'), guide.indexOf('## What to look for'))
  const rows = table
    .split('\n')
    .filter((l) => /^\| (assets|liabilities|expenses|income|equity)/.test(l))
  return new Map(
    rows.map((row) => {
      const [, path = '', , shown = ''] = row.split('|').map((c) => c.trim())
      const sorted =
        shown === '0'
          ? '0'
          : shown
              .split(' · ')
              .sort((a, b) => a.slice(-3).localeCompare(b.slice(-3)))
              .join(' · ')
      return [path.replace(' (deleted)', ''), sorted]
    }),
  )
}

const liveCount = (where: Where) => {
  const ledger = open(where, NOW)
  try {
    return ledger.db
      .prepare('SELECT count(*) FROM transactions WHERE deletedAt IS NULL')
      .pluck()
      .get()
  } finally {
    ledger.close()
  }
}

describe('a seeded year', () => {
  test('the same seed and today give the same ledger, and another seed a different one', () => {
    const docs = (seed: string) =>
      JSON.stringify(build('year', { ...at, seed }).entries.map((e) => [e.doc, e.final]))
    expect(docs('1')).toBe(docs('1'))
    expect(docs('2')).not.toBe(docs('1'))
  })

  test('is written whole, and the guide states every balance the ledger holds', () => {
    const where = aSandbox()
    const report = seedInto(where, 'year', at)

    expect(report.transactions).toBeGreaterThan(1_200)
    expect(guideBalances(where)).toEqual(ledgerBalances(where))
  })

  test('has every shape the guide describes, but the odd cases', () => {
    const found = new Set(build('year').entries.map((e) => e.shape))
    const all = Object.keys(SHAPES).filter((s) => s !== 'edge') as Shape[]

    expect(all.filter((s) => !found.has(s))).toEqual([])
  })

  test('a spend Wise half-converts draws on two balances and balances in each currency', () => {
    const book = build('year')
    const mixed = book.entries.filter(
      (e) => e.shape === 'wise-mixed' && e.doc.postings.length === 6,
    )
    const ids = new Map([...book.accounts.values()].map((a) => [a.id, a.path]))

    expect(mixed.length).toBeGreaterThan(0)
    for (const { doc } of mixed) {
      const wises = doc.postings.filter((p) => ids.get(p.accountId)?.startsWith('assets:wise:'))
      expect(new Set(wises.map((p) => p.currency)).size).toBe(2)
      const sums = new Map<string, number>()
      for (const p of doc.postings)
        sums.set(p.currency, (sums.get(p.currency) ?? 0) + cents(p.amount))
      expect([...sums.values()].every((c) => c === 0)).toBe(true)
    }
  })

  test('leaves no Wise balance or wallet currency below zero, and yen whole', () => {
    const book = build('year')
    const balances = book.finalBalances()
    const kept = [CASH, ...WISE_HOLDS.map(wise)]

    for (const path of kept) {
      for (const [, c] of balances.get(path) ?? []) expect(c).toBeGreaterThanOrEqual(0)
    }
    const whole = book.entries
      .flatMap((e) => e.final.postings)
      .filter((p) => minorUnits(p.currency) === 0)
    expect(whole.length).toBeGreaterThan(0)
    expect(whole.filter((p) => cents(p.amount) % 100 !== 0)).toEqual([])
  })

  test('dates nothing after today', () => {
    const latest = build('year')
      .entries.map((e) => e.doc.date)
      .sort()
      .at(-1)
    expect(latest).toBe(TODAY)
  })

  test('charges each monthly bill once a month, and stops the one cancelled', () => {
    const book = build('year')
    const times = (series: string) => book.entries.filter((e) => e.series === series).length

    for (const series of ['Netflix', 'Spotify', 'Internet', 'Phone', 'Hydro', 'Family support']) {
      expect(times(series), series).toBe(12)
    }
    expect(times('Disney+')).toBeLessThan(6)
  })

  test('tags.json lists live transactions, each carrying its tag', () => {
    const where = aSandbox()
    seedInto(where, 'year', at)
    const { tags } = JSON.parse(readFileSync(join(where.root, 'tags.json'), 'utf8'))
    const book = build('year')
    const byId = new Map(book.entries.map((e) => [e.final.id, e]))

    expect(Object.keys(tags)).toEqual(
      expect.arrayContaining([
        '#taiwan2026',
        '#china2026',
        '#fix-car',
        '#ottawa-move-2026',
        '#prague-cousin-wedding-2027',
      ]),
    )
    for (const [tag, ids] of Object.entries(tags as Record<string, string[]>)) {
      for (const id of ids) {
        const e = byId.get(id)
        expect(e?.final.deletedAt).toBeNull()
        expect(e?.tags).toContain(tag)
      }
    }
  })
})

describe('a top-up', () => {
  test('carries a ledger forward to what a full seed from the same start holds', () => {
    const where = aSandbox()
    seedInto(where, 'year', { ...at, today: '2026-10-08', nowMs: Date.UTC(2026, 9, 9, 3) })
    const start = JSON.parse(readFileSync(join(where.root, 'seed.json'), 'utf8')).start
    const added = topUp(where, { today: TODAY, nowMs: NOW })
    const full = PROFILES.year?.build({ ...at, deviceId: '0123456789abcdef' }, start)
    const live = full?.book.entries.filter((e) => e.final.deletedAt === null).length

    expect(added.transactions).toBeGreaterThan(50)
    expect(liveCount(where)).toBe(live)
    // The guide is written from that full seed.
    expect(guideBalances(where)).toEqual(ledgerBalances(where))
  })

  test('adds nothing when the ledger already reaches today', () => {
    const where = aSandbox()
    seedInto(where, 'year', at)

    expect(topUp(where, { today: TODAY, nowMs: NOW }).transactions).toBe(0)
  })
})

describe('the other profiles', () => {
  test('edge has its odd cases, and the guide states their balances', () => {
    const where = aSandbox('edge')
    seedInto(where, 'edge', at)

    expect(build('edge').entries.filter((e) => e.shape === 'edge').length).toBeGreaterThan(50)
    expect(guideBalances(where)).toEqual(ledgerBalances(where))
  })

  test('starter has balances and nothing spent', () => {
    const shapes = new Set(build('starter').entries.map((e) => e.shape))
    expect([...shapes]).toEqual(['opening'])
  })

  test('empty writes no ledger file', () => {
    const where = aSandbox('empty')
    seedInto(where, 'empty', at)
    expect(() => readFileSync(ledgerPath(where))).toThrow()
  })

  test('the decade reaches the performance budget', () => {
    const n = build('decade').entries.length
    expect(n).toBeGreaterThan(45_000)
    expect(n).toBeLessThan(55_000)
  })
})

describe('safety', () => {
  test('refuses while the app has the folder open', () => {
    const where = aSandbox()
    mkdirSync(join(where.env.XDG_CONFIG_HOME, 'have-fish'), { recursive: true })
    symlinkSync(
      `somehost-${process.pid}`,
      join(where.env.XDG_CONFIG_HOME, 'have-fish', 'SingletonLock'),
    )

    expect(() => seedInto(where, 'year', at)).toThrow(/has this ledger open/)
  })

  test('refuses the real folder when a ledger is already there', () => {
    const home = mkdtempSync(join(tmpdir(), 'havefish-real-'))
    onTestFinished(() => rmSync(home, { recursive: true, force: true }))
    const real = realFolders({
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CONFIG_HOME: join(home, 'config'),
    })
    mkdirSync(real.data, { recursive: true })
    writeFileSync(ledgerPath(real), 'mine')

    expect(() => seedInto(real, 'starter', at)).toThrow(/already a ledger/)
    expect(readFileSync(ledgerPath(real), 'utf8')).toBe('mine')
  })

  test('snap and restore bring back the ledger as it was', () => {
    const where = aSandbox('edge')
    seedInto(where, 'edge', at)
    const before = ledgerBalances(where)
    snap(where, 'kept')
    seedInto(where, 'starter', at)
    expect(ledgerBalances(where)).not.toEqual(before)

    restore(where, 'kept')
    expect(ledgerBalances(where)).toEqual(before)
  })
})
