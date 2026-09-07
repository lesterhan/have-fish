import { describe, it, expect } from 'bun:test'
import type { Posting, StoredAccountType, Transaction } from '$lib/api'
import { dayNet, groupByDay, ledgerTone, subjectPosting } from './ledger'

// ── Fixtures ────────────────────────────────────────────────
//
// A tiny ledger: a card and a chequing account, an expense account, an income account.
// Types are looked up the way the pages look them up — by id, possibly missing.

const TYPES: Record<string, StoredAccountType> = {
  card: 'liability',
  chequing: 'asset',
  groceries: 'expense',
  salary: 'income',
}

const typeOf = (id: string) => TYPES[id] ?? null

function posting(accountId: string, amount: string, currency = 'CAD'): Posting {
  return {
    id: `${accountId}:${amount}`,
    accountId,
    accountPath: accountId,
    accountName: null,
    amount,
    currency,
    role: 'other' as Posting['role'],
  }
}

function tx(date: string, ...postings: Posting[]): Transaction {
  return {
    id: postings.map((p) => p.id).join('+'),
    userId: 'u',
    date,
    description: null,
    groupExpenseId: null,
    groupName: null,
    postings,
  }
}

const SPEND = tx(
  '2026-09-06',
  posting('card', '-42.00'),
  posting('groceries', '42.00'),
)
const REFUND = tx(
  '2026-09-06',
  posting('card', '18.00'),
  posting('groceries', '-18.00'),
)
const INCOME = tx(
  '2026-09-06',
  posting('chequing', '2500.00'),
  posting('salary', '-2500.00'),
)
const PAYDOWN = tx(
  '2026-09-06',
  posting('card', '500.00'),
  posting('chequing', '-500.00'),
)

// ── Which posting the row is about ──────────────────────────

describe('subjectPosting', () => {
  it('is the account you are looking at, when you are looking at one', () => {
    expect(subjectPosting(SPEND.postings, typeOf, 'card')?.accountId).toBe(
      'card',
    )
    // The same row from the other side. Nothing about the row changed; the question did.
    expect(subjectPosting(SPEND.postings, typeOf, 'groceries')?.accountId).toBe(
      'groceries',
    )
  })

  it('is the own-money side when no account has been named', () => {
    // The global list has no current account, so the row is about what happened to your
    // money — never about the expense category, which is only a label for where it went.
    expect(subjectPosting(SPEND.postings, typeOf)?.accountId).toBe('card')
    expect(subjectPosting(INCOME.postings, typeOf)?.accountId).toBe('chequing')
  })

  it('reports nothing when no side is your own money', () => {
    const reclassify = tx(
      '2026-09-06',
      posting('groceries', '-10.00'),
      posting('salary', '10.00'),
    )
    expect(subjectPosting(reclassify.postings, typeOf)).toBeNull()
  })

  it('does not care which own-money side it picks on a transfer', () => {
    // Both are yours, so either answers the tone question identically — which is the reason
    // a plain `find` is safe here rather than a rule about ordering.
    const picked = subjectPosting(PAYDOWN.postings, typeOf)
    expect(picked).not.toBeNull()
    expect(['card', 'chequing']).toContain(picked!.accountId)
    expect(ledgerTone(PAYDOWN.postings, typeOf)).toBe('transfer')
  })
})

// ── The sign rule, resolved ─────────────────────────────────

describe('ledgerTone', () => {
  it('agrees with itself on both surfaces', () => {
    // The point of the shared helper: the account page and the global list reach the same
    // answer for the same row. Before this they reached different ones, because only one of
    // them had a rule.
    for (const [postings, expected] of [
      [SPEND.postings, 'neutral'],
      [REFUND.postings, 'positive'],
      [INCOME.postings, 'positive'],
      [PAYDOWN.postings, 'transfer'],
    ] as const) {
      const global = ledgerTone(postings, typeOf)
      const onAccount = ledgerTone(postings, typeOf, postings[0]?.accountId)
      expect(global).toBe(expected)
      expect(onAccount).toBe(expected)
    }
  })

  it('is neutral when the row touches none of your accounts', () => {
    const reclassify = tx(
      '2026-09-06',
      posting('groceries', '-10.00'),
      posting('salary', '10.00'),
    )
    expect(ledgerTone(reclassify.postings, typeOf)).toBe('neutral')
  })
})

// ── The day's net ───────────────────────────────────────────

describe('dayNet', () => {
  it('sums what the day did to your money, not to the ledger', () => {
    // Summing every posting is always zero — a ledger balances. What the band reports is
    // the movement on your own side.
    expect(dayNet([SPEND, REFUND], typeOf)).toEqual({
      kind: 'net',
      cents: -2400,
      currency: 'CAD',
    })
  })

  it('answers from the account you are on', () => {
    expect(dayNet([SPEND], typeOf, 'card')).toEqual({
      kind: 'net',
      cents: -4200,
      currency: 'CAD',
    })
    expect(dayNet([SPEND], typeOf, 'groceries')).toEqual({
      kind: 'net',
      cents: 4200,
      currency: 'CAD',
    })
  })

  it('refuses to add currencies together and says which', () => {
    const euro = tx(
      '2026-09-06',
      posting('card', '-10.00', 'EUR'),
      posting('groceries', '10.00', 'EUR'),
    )
    expect(dayNet([SPEND, euro], typeOf)).toEqual({
      kind: 'mixed',
      currencies: ['CAD', 'EUR'],
    })
  })

  it('withholds the figure when one amount cannot be read', () => {
    // A bad row treated as zero produces a net that is wrong and looks right. Better to
    // have no figure than a confident wrong one.
    const broken = tx(
      '2026-09-06',
      posting('card', 'not a number'),
      posting('groceries', '1.00'),
    )
    expect(dayNet([SPEND, broken], typeOf).kind).toBe('mixed')
  })

  it('says nothing rather than zero when no side is yours', () => {
    const reclassify = tx(
      '2026-09-06',
      posting('groceries', '-10.00'),
      posting('salary', '10.00'),
    )
    expect(dayNet([reclassify], typeOf)).toEqual({ kind: 'none' })
  })
})

// ── Runs ────────────────────────────────────────────────────

describe('groupByDay', () => {
  it('collects consecutive rows of one date', () => {
    const groups = groupByDay(
      [SPEND, REFUND, tx('2026-09-05', ...INCOME.postings)],
      typeOf,
    )
    expect(groups.map((g) => [g.date, g.transactions.length])).toEqual([
      ['2026-09-06', 2],
      ['2026-09-05', 1],
    ])
  })

  it('carries each run its own net', () => {
    const groups = groupByDay(
      [SPEND, tx('2026-09-05', ...INCOME.postings)],
      typeOf,
    )
    expect(groups[0]!.net).toEqual({
      kind: 'net',
      cents: -4200,
      currency: 'CAD',
    })
    expect(groups[1]!.net).toEqual({
      kind: 'net',
      cents: 250000,
      currency: 'CAD',
    })
  })

  it('does not reorder a list that was ordered on purpose', () => {
    // Two runs of the same date rather than one merged group: re-sorting here would quietly
    // repair a list the caller arranged some other way, and hide that it had.
    const groups = groupByDay(
      [SPEND, tx('2026-09-05', ...INCOME.postings), REFUND],
      typeOf,
    )
    expect(groups.map((g) => g.date)).toEqual([
      '2026-09-06',
      '2026-09-05',
      '2026-09-06',
    ])
  })

  it('handles an empty list', () => {
    expect(groupByDay([], typeOf)).toEqual([])
  })

  it('reads the date out of a timestamp', () => {
    const groups = groupByDay(
      [tx('2026-09-06T14:03:00.000Z', ...SPEND.postings)],
      typeOf,
    )
    expect(groups[0]!.date).toBe('2026-09-06')
  })
})
