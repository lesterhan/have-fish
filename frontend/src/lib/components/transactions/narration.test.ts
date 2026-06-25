import { describe, it, expect } from 'bun:test'
import { narrateTransaction, prettifyPath, accountLabel } from './narration'
import type { Posting, PostingRole } from '$lib/api'

// Terse posting fixture. id derived from path+amount; accountName optional so the label
// resolver can be exercised. accountId == path so any id-based assertions read clearly.
function p(
  accountPath: string,
  amount: string,
  currency: string,
  role: PostingRole,
  accountName: string | null = null,
): Posting {
  return {
    id: accountPath + ':' + amount,
    accountId: accountPath,
    accountPath,
    accountName,
    amount,
    currency,
    role,
  }
}

// --- Canonical archetype shapes (each balances to zero per currency) --------------------

// Simple spend: 50 CAD coffee from chequing.
const simpleSpend = (): Posting[] => [
  p('assets:chequing', '-50.00', 'CAD', 'transfer'),
  p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
]

// Fish Pie split: 30 CAD bill fronted on visa; your share 20, roommates owe 10.
const splitSpend = (): Posting[] => [
  p('liabilities:visa', '-30.00', 'CAD', 'transfer'),
  p('expenses:food', '20.00', 'CAD', 'subject'),
  p('assets:receivable:roommates', '10.00', 'CAD', 'share'),
]

// Multi-currency: 360 CZK coffee paid from a USD account. Two equity bridges balance each
// currency; rate = 360 / 17.24 = 20.88 CZK/USD.
const multiCcySpend = (): Posting[] => [
  p('expenses:food:coffee', '360.00', 'CZK', 'subject'),
  p('assets:usd', '-17.24', 'USD', 'transfer'),
  p('equity:conversions', '-360.00', 'CZK', 'conversion'),
  p('equity:conversions', '17.24', 'USD', 'conversion'),
]

// Multi-currency WITH an FX fee: 50 EUR cafe from a CAD Wise wallet, 0.05 EUR fee.
//   EUR: 50 + 0.05 - 50.05 = 0   CAD: -80.08 + 80.08 = 0
const multiCcyWithFee = (): Posting[] => [
  p('expenses:food:cafe', '50.00', 'EUR', 'subject'),
  p('expenses:banking:fee', '0.05', 'EUR', 'fee'),
  p('assets:wise:cad', '-80.08', 'CAD', 'transfer'),
  p('equity:conversions', '-50.05', 'EUR', 'conversion'),
  p('equity:conversions', '80.08', 'CAD', 'conversion'),
]

// Income: 2000 CAD paycheck. Subject stored negative, asset positive.
const income = (): Posting[] => [
  p('assets:chequing', '2000.00', 'CAD', 'transfer'),
  p('income:salary', '-2000.00', 'CAD', 'subject'),
]

// Refund: 10 CAD came back onto the card (a negative expense).
const refund = (): Posting[] => [
  p('assets:chequing', '10.00', 'CAD', 'transfer'),
  p('expenses:food:cafe', '-10.00', 'CAD', 'subject'),
]

describe('archetype detection', () => {
  it('simple spend', () => {
    expect(narrateTransaction(simpleSpend()).archetype).toBe('direct')
  })
  it('split (has a share leg)', () => {
    expect(narrateTransaction(splitSpend()).archetype).toBe('split')
  })
  it('multi-currency (has an FX bridge)', () => {
    expect(narrateTransaction(multiCcySpend()).archetype).toBe('multiCurrency')
  })
  it('inflow (income / refund — subject stored negative)', () => {
    expect(narrateTransaction(income()).archetype).toBe('inflow')
    expect(narrateTransaction(refund()).archetype).toBe('inflow')
  })
  it('same-currency multi-category split is still direct', () => {
    const n = narrateTransaction([
      p('assets:chequing', '-75.00', 'CAD', 'transfer'),
      p('expenses:food:groceries', '50.00', 'CAD', 'subject'),
      p('expenses:home:supplies', '25.00', 'CAD', 'subject'),
    ])
    expect(n.archetype).toBe('direct')
  })
})

describe('hero', () => {
  it('simple spend → the expense leg, not inflow', () => {
    const h = narrateTransaction(simpleSpend()).hero
    expect(h?.path).toBe('expenses:food:cafe')
    expect(h?.amount).toBe('50.00')
    expect(h?.inflow).toBe(false)
  })

  it('income → the income leg, marked inflow (negative amount kept signed)', () => {
    const h = narrateTransaction(income()).hero
    expect(h?.path).toBe('income:salary')
    expect(h?.amount).toBe('-2000.00')
    expect(h?.inflow).toBe(true)
  })

  it('refund → marked inflow', () => {
    expect(narrateTransaction(refund()).hero?.inflow).toBe(true)
  })

  it('largest-abs subject wins on a multi-category split', () => {
    const h = narrateTransaction([
      p('assets:chequing', '-75.00', 'CAD', 'transfer'),
      p('expenses:food:groceries', '50.00', 'CAD', 'subject'),
      p('expenses:home:supplies', '25.00', 'CAD', 'subject'),
    ]).hero
    expect(h?.path).toBe('expenses:food:groceries')
  })

  it('uses the friendly name when set', () => {
    const h = narrateTransaction([
      p('assets:chequing', '-50.00', 'CAD', 'transfer'),
      p('expenses:food:cafe', '50.00', 'CAD', 'subject', 'Morning Coffee'),
    ]).hero
    expect(h?.label).toBe('Morning Coffee')
    expect(h?.path).toBe('expenses:food:cafe')
  })

  it('null when there is no subject leg', () => {
    const n = narrateTransaction([
      p('assets:savings', '1000.00', 'CAD', 'transfer'),
      p('equity:opening-balances', '-1000.00', 'CAD', 'conversion'),
    ])
    expect(n.hero).toBeNull()
  })
})

describe('source', () => {
  it('outflow → the asset the money left (most-negative transfer)', () => {
    expect(narrateTransaction(simpleSpend()).source?.accountPath).toBe('assets:chequing')
    expect(narrateTransaction(multiCcySpend()).source?.accountPath).toBe('assets:usd')
    expect(narrateTransaction(splitSpend()).source?.accountPath).toBe('liabilities:visa')
  })

  it('inflow → the asset the money landed in (most-positive transfer)', () => {
    expect(narrateTransaction(income()).source?.accountPath).toBe('assets:chequing')
    expect(narrateTransaction(refund()).source?.accountPath).toBe('assets:chequing')
  })

  it('null when there is no transfer leg', () => {
    const n = narrateTransaction([
      p('assets:savings', '1000.00', 'CAD', 'transfer'),
      p('equity:opening-balances', '-1000.00', 'CAD', 'conversion'),
    ])
    // savings is the only transfer → it IS the source; the equity leg is not a transfer.
    expect(n.source?.accountPath).toBe('assets:savings')
  })
})

describe('branches + chips', () => {
  it('simple spend → one `the-spend` branch; source excluded', () => {
    const b = narrateTransaction(simpleSpend()).branches
    expect(b.map((x) => x.path)).toEqual(['expenses:food:cafe'])
    expect(b[0].chip).toBe('the-spend')
  })

  it('split → `your-share` on the subject, `owes-you` on the receivable', () => {
    const b = narrateTransaction(splitSpend()).branches
    expect(b.map((x) => [x.path, x.chip])).toEqual([
      ['expenses:food', 'your-share'],
      ['assets:receivable:roommates', 'owes-you'],
    ])
  })

  it('payable share → `you-owe`', () => {
    const b = narrateTransaction([
      p('assets:chequing', '100.00', 'CAD', 'transfer'),
      p('expenses:food', '-150.00', 'CAD', 'subject'),
      p('liabilities:payable:alex', '50.00', 'CAD', 'share'),
    ]).branches
    expect(b.find((x) => x.path === 'liabilities:payable:alex')?.chip).toBe('you-owe')
  })

  it('multi-currency → `the-spend` + `fx-fee`; conversion bridges never appear', () => {
    const b = narrateTransaction(multiCcyWithFee()).branches
    expect(b.map((x) => [x.path, x.chip])).toEqual([
      ['expenses:food:cafe', 'the-spend'],
      ['expenses:banking:fee', 'fx-fee'],
    ])
    expect(b.some((x) => x.posting.role === 'conversion')).toBe(false)
  })

  it('inflow → the subject branch carries the green `deposit` chip', () => {
    const b = narrateTransaction(income()).branches
    expect(b.map((x) => [x.path, x.chip])).toEqual([['income:salary', 'deposit']])
  })
})

describe('conversion', () => {
  it('null on a same-currency transaction', () => {
    expect(narrateTransaction(simpleSpend()).conversion).toBeNull()
    expect(narrateTransaction(splitSpend()).conversion).toBeNull()
  })

  it('derives the rate from the two equity bridge legs (20.88 CZK/USD)', () => {
    const c = narrateTransaction(multiCcySpend()).conversion
    expect(c).not.toBeNull()
    expect(c?.rate).toBe('20.88')
    expect(c?.rateUnit).toBe('CZK/USD')
    expect(c?.paid).toEqual({ amount: '17.24', currency: 'USD' })
    expect(c?.converted).toEqual({ amount: '360.00', currency: 'CZK' })
    expect(c?.fee).toBeNull()
  })

  it('surfaces the FX fee when present', () => {
    const c = narrateTransaction(multiCcyWithFee()).conversion
    expect(c?.fee).toEqual({ amount: '0.05', currency: 'EUR' })
    expect(c?.paid).toEqual({ amount: '80.08', currency: 'CAD' })
    expect(c?.converted).toEqual({ amount: '50.05', currency: 'EUR' })
    // sub-1 rate keeps extra precision: 50.05 / 80.08 = 0.6250.
    expect(c?.rate).toBe('0.6250')
    expect(c?.rateUnit).toBe('EUR/CAD')
  })

  it('null when only one bridge leg exists (degenerate single-conversion shape)', () => {
    const n = narrateTransaction([
      p('expenses:food:cafe', '50.00', 'EUR', 'subject'),
      p('assets:wise:eur', '50.00', 'EUR', 'transfer'),
      p('assets:wise:cad', '-80.00', 'CAD', 'transfer'),
      p('equity:conversions', '80.00', 'CAD', 'conversion'),
    ])
    expect(n.conversion).toBeNull()
  })
})

describe('balances', () => {
  it('ok on every canonical (balanced) shape', () => {
    for (const shape of [simpleSpend, splitSpend, multiCcySpend, multiCcyWithFee, income, refund]) {
      expect(narrateTransaction(shape()).balances.ok).toBe(true)
    }
  })

  it('reports the per-currency sums', () => {
    const bal = narrateTransaction(multiCcyWithFee()).balances
    expect(bal.ok).toBe(true)
    const eur = bal.byCurrency.find((b) => b.currency === 'EUR')
    const cad = bal.byCurrency.find((b) => b.currency === 'CAD')
    expect(eur?.sum).toBe('0.00')
    expect(cad?.sum).toBe('0.00')
  })

  it('false on a deliberately unbalanced shape', () => {
    const bal = narrateTransaction([
      p('assets:chequing', '-50.00', 'CAD', 'transfer'),
      p('expenses:food:cafe', '45.00', 'CAD', 'subject'),
    ]).balances
    expect(bal.ok).toBe(false)
    expect(bal.byCurrency.find((b) => b.currency === 'CAD')?.sum).toBe('-5.00')
  })
})

describe('allPostings', () => {
  it('passes through every raw leg incl. the equity bridges, in order', () => {
    const postings = multiCcyWithFee()
    expect(narrateTransaction(postings).allPostings).toEqual(postings)
  })
})

describe('robustness', () => {
  it('empty postings → safe empty narration, no throw', () => {
    const n = narrateTransaction([])
    expect(n.archetype).toBe('direct')
    expect(n.hero).toBeNull()
    expect(n.source).toBeNull()
    expect(n.branches).toHaveLength(0)
    expect(n.conversion).toBeNull()
    expect(n.balances.ok).toBe(true)
  })

  it('malformed single leg → does not throw', () => {
    expect(() =>
      narrateTransaction([p('assets:mystery', '10.00', 'CAD', 'transfer')]),
    ).not.toThrow()
  })

  it('malformed: subject with no transfer → hero set, source null, no throw', () => {
    const n = narrateTransaction([p('expenses:food', '5.00', 'CAD', 'subject')])
    expect(n.hero?.path).toBe('expenses:food')
    expect(n.source).toBeNull()
    expect(n.branches.map((b) => b.path)).toEqual(['expenses:food'])
  })
})

describe('prettifyPath', () => {
  it('drops the root and title-cases the last 1-2 segments', () => {
    expect(prettifyPath('expenses:housing:rent')).toBe('Housing · Rent')
    expect(prettifyPath('expenses:food')).toBe('Food')
    expect(prettifyPath('assets:wise:cad')).toBe('Wise · Cad')
    expect(prettifyPath('assets:receivable:roommates')).toBe('Receivable · Roommates')
  })

  it('title-cases hyphenated segments word-by-word', () => {
    expect(prettifyPath('equity:opening-balances')).toBe('Opening Balances')
  })

  it('handles a single-segment path', () => {
    expect(prettifyPath('cash')).toBe('Cash')
  })

  it('returns the input for an empty path', () => {
    expect(prettifyPath('')).toBe('')
  })
})

describe('accountLabel', () => {
  it('prefers the explicit name', () => {
    expect(accountLabel({ accountName: 'Eating Out', accountPath: 'expenses:food:cafe' })).toBe(
      'Eating Out',
    )
  })

  it('falls back to the prettified path when name is null or blank', () => {
    expect(accountLabel({ accountName: null, accountPath: 'expenses:food:cafe' })).toBe(
      'Food · Cafe',
    )
    expect(accountLabel({ accountName: '   ', accountPath: 'expenses:food:cafe' })).toBe(
      'Food · Cafe',
    )
  })
})
