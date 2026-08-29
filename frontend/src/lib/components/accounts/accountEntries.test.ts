import { describe, it, expect } from 'bun:test'
import { RECENT_ENTRIES, entryLines } from './accountEntries'
import type { Posting, Transaction } from '../../api'

let seq = 0

function posting(
  accountPath: string,
  amount: string,
  currency = 'CAD',
): Posting {
  return {
    id: `p${seq++}`,
    accountId: `id:${accountPath}`,
    accountPath,
    accountName: null,
    amount,
    currency,
    role: 'other' as Posting['role'],
  }
}

function tx(
  id: string,
  date: string,
  description: string | null,
  postings: Posting[],
): Transaction {
  return {
    id,
    userId: 'u',
    date,
    description,
    groupExpenseId: null,
    groupName: null,
    postings,
  }
}

const CHEQUING = { kind: 'account', accountId: 'id:assets:chequing' } as const

describe('entryLines', () => {
  const groceries = tx('t1', '2026-08-27', 'Loblaws', [
    posting('assets:chequing', '-42.10'),
    posting('expenses:food:groceries', '42.10'),
  ])

  it('reports the movement as this account saw it, not the expense leg', () => {
    const [line] = entryLines([groceries], CHEQUING)
    expect(line).toMatchObject({
      date: '2026-08-27',
      description: 'Loblaws',
      cents: -4210,
      currency: 'CAD',
    })
  })

  it('names the other side of the entry', () => {
    expect(entryLines([groceries], CHEQUING)[0]!.counterparty).toBe(
      'expenses:food:groceries',
    )
  })

  it('shortens the counterparty against a root when one is given', () => {
    const line = entryLines([groceries], CHEQUING, { root: 'expenses' })[0]!
    expect(line.counterparty).toBe('food:groceries')
  })

  it('calls a multi-leg other side a split rather than picking one', () => {
    const split = tx('t2', '2026-08-26', 'Costco run', [
      posting('assets:chequing', '-100.00'),
      posting('expenses:food:groceries', '60.00'),
      posting('expenses:household', '40.00'),
    ])
    expect(entryLines([split], CHEQUING)[0]!.counterparty).toBe('split')
  })

  it('has no counterparty when the entry only touches this account', () => {
    const solo = tx('t3', '2026-08-25', 'Opening balance', [
      posting('assets:chequing', '500.00'),
    ])
    expect(entryLines([solo], CHEQUING)[0]!.counterparty).toBeNull()
  })

  it('sums several postings on the same account in one entry', () => {
    const twice = tx('t4', '2026-08-24', 'Two fees', [
      posting('assets:chequing', '-3.00'),
      posting('assets:chequing', '-2.00'),
      posting('expenses:fees', '5.00'),
    ])
    expect(entryLines([twice], CHEQUING)[0]!.cents).toBe(-500)
  })

  it('flags a conversion rather than summing across currencies', () => {
    const conversion = tx('t5', '2026-08-23', 'CAD → USD', [
      posting('assets:chequing', '-100.00', 'CAD'),
      posting('assets:chequing', '73.00', 'USD'),
      posting('equity:conversions', '100.00', 'CAD'),
    ])
    const line = entryLines([conversion], CHEQUING)[0]!
    expect(line.mixedCurrency).toBe(true)
    // Only the first currency's legs are summed — 100 CAD out, with the USD leg left out.
    expect(line).toMatchObject({ currency: 'CAD', cents: -10000 })
  })

  it('matches a category row against its whole subtree', () => {
    const lines = entryLines([groceries], {
      kind: 'subtree',
      path: 'expenses:food',
    })
    expect(lines[0]!.cents).toBe(4210)
    expect(lines[0]!.counterparty).toBe('assets:chequing')
  })

  it('does not match a path that merely shares a prefix', () => {
    const other = tx('t6', '2026-08-22', 'Foodstuffs', [
      posting('expenses:foodstuffs', '10.00'),
      posting('assets:chequing', '-10.00'),
    ])
    expect(
      entryLines([other], { kind: 'subtree', path: 'expenses:food' }),
    ).toEqual([])
  })

  it('drops an entry that does not touch the account at all', () => {
    const elsewhere = tx('t7', '2026-08-21', 'Rent', [
      posting('assets:savings', '-1200.00'),
      posting('expenses:rent', '1200.00'),
    ])
    expect(entryLines([elsewhere], CHEQUING)).toEqual([])
  })

  it('orders newest first and caps at the limit', () => {
    const many = ['2026-08-01', '2026-08-05', '2026-08-03', '2026-08-09'].map(
      (date, i) =>
        tx(`m${i}`, date, date, [
          posting('assets:chequing', '-1.00'),
          posting('expenses:food', '1.00'),
        ]),
    )
    expect(entryLines(many, CHEQUING, { limit: 2 }).map((l) => l.date)).toEqual(
      ['2026-08-09', '2026-08-05'],
    )
    expect(entryLines(many, CHEQUING)).toHaveLength(4)
  })

  it('defaults to the drawer limit', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      tx(`n${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`, 'x', [
        posting('assets:chequing', '-1.00'),
        posting('expenses:food', '1.00'),
      ]),
    )
    expect(entryLines(many, CHEQUING)).toHaveLength(RECENT_ENTRIES)
  })

  it('trims a date that carries a time, and an empty description', () => {
    const timed = tx('t8', '2026-08-20T00:00:00.000Z', '   ', [
      posting('assets:chequing', '-1.00'),
    ])
    expect(entryLines([timed], CHEQUING)[0]).toMatchObject({
      date: '2026-08-20',
      description: '—',
    })
  })

  it('is empty for an empty list', () => {
    expect(entryLines([], CHEQUING)).toEqual([])
  })
})
