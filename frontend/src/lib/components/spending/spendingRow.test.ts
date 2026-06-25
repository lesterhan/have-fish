import { describe, it, expect } from 'bun:test'
import {
  headlineSubject,
  rowSource,
  stripRoot,
  hasSubjectInCurrency,
  txSubjectTotal,
} from './spendingRow'
import type { Transaction, Posting, PostingRole } from '$lib/api'

// Terse posting fixture; id derived from accountPath + amount unless overridden.
function p(
  accountPath: string,
  amount: string,
  currency: string,
  role: PostingRole,
  id = accountPath + ':' + amount,
): Posting {
  return { id, accountId: accountPath, accountPath, amount, currency, role }
}

function tx(postings: Posting[]): Transaction {
  return {
    id: 't1',
    userId: 'u1',
    date: '2026-06-10',
    description: 'Test',
    groupExpenseId: null,
    groupName: null,
    postings,
  }
}

// Plain 2-leg spend.
const plain = tx([
  p('assets:chequing', '-50.00', 'CAD', 'transfer'),
  p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
])

// Fee-bearing cross-currency Wise spend: the fee leg is also `expenses:`-rooted, which the
// old heuristic could mistake for the spend; the role classifier keeps them distinct.
const wise = tx([
  p('assets:wise:cad', '-80.00', 'CAD', 'transfer'),
  p('assets:wise:eur', '50.00', 'EUR', 'transfer'),
  p('equity:conversion', '80.00', 'CAD', 'conversion'),
  p('expenses:banking:fee', '0.05', 'EUR', 'fee'),
  p('expenses:food:cafe', '50.00', 'EUR', 'subject'),
])

describe('headlineSubject', () => {
  it('returns the subject leg for a plain spend', () => {
    expect(headlineSubject(plain)?.accountPath).toBe('expenses:food:cafe')
  })

  it('picks the subject, never the fee leg, on a fee-bearing Wise spend', () => {
    const h = headlineSubject(wise)
    expect(h?.accountPath).toBe('expenses:food:cafe')
    expect(h?.amount).toBe('50.00')
    expect(h?.currency).toBe('EUR')
  })

  it('returns the largest-abs subject when several exist', () => {
    const split = tx([
      p('assets:chequing', '-130.00', 'CAD', 'transfer'),
      p('expenses:food:cafe', '30.00', 'CAD', 'subject'),
      p('expenses:home:rent', '100.00', 'CAD', 'subject'),
    ])
    expect(headlineSubject(split)?.accountPath).toBe('expenses:home:rent')
  })

  it('returns null when there is no subject leg', () => {
    const transferOnly = tx([
      p('assets:a', '-10.00', 'CAD', 'transfer'),
      p('assets:b', '10.00', 'CAD', 'transfer'),
    ])
    expect(headlineSubject(transferOnly)).toBeNull()
  })
})

describe('rowSource', () => {
  it('is the account the money left', () => {
    expect(rowSource(plain)?.accountPath).toBe('assets:chequing')
    expect(rowSource(wise)?.accountPath).toBe('assets:wise:cad')
  })
})

describe('stripRoot', () => {
  it('drops the root segment', () => {
    expect(stripRoot('expenses:food:cafe')).toBe('food:cafe')
    expect(stripRoot('assets:wise:cad')).toBe('wise:cad')
  })
})

describe('hasSubjectInCurrency', () => {
  it('ALL matches any transaction with a subject', () => {
    expect(hasSubjectInCurrency(wise, 'ALL')).toBe(true)
  })

  it('matches on the subject currency, not the mechanical legs', () => {
    // The Wise spend has subject in EUR; its transfer legs include CAD, but those are not
    // subjects, so a CAD filter must not match.
    expect(hasSubjectInCurrency(wise, 'EUR')).toBe(true)
    expect(hasSubjectInCurrency(wise, 'CAD')).toBe(false)
    expect(hasSubjectInCurrency(plain, 'CAD')).toBe(true)
  })
})

describe('txSubjectTotal', () => {
  it('counts only the subject leg — no double-count from mechanical legs', () => {
    // The Wise spend is 50 EUR; at 1.5 CAD/EUR it is 75 CAD, NOT inflated by the 80 CAD
    // transfer/conversion legs.
    expect(txSubjectTotal(wise, { EUR: 1.5, CAD: 1 }, 'ALL')).toBeCloseTo(75, 6)
  })

  it('excludes the fee leg from the spend total', () => {
    // Fee is 0.05 EUR; only the 50 EUR subject is summed.
    expect(txSubjectTotal(wise, { EUR: 1, CAD: 1 }, 'ALL')).toBeCloseTo(50, 6)
  })

  it('filters by currency', () => {
    expect(txSubjectTotal(wise, { EUR: 1, CAD: 1 }, 'CAD')).toBe(0)
    expect(txSubjectTotal(wise, { EUR: 1, CAD: 1 }, 'EUR')).toBeCloseTo(50, 6)
  })

  it('falls back to a rate of 1 for an unknown currency', () => {
    expect(txSubjectTotal(plain, {}, 'ALL')).toBeCloseTo(50, 6)
  })

  it('sums multiple subjects', () => {
    const split = tx([
      p('assets:chequing', '-130.00', 'CAD', 'transfer'),
      p('expenses:food:cafe', '30.00', 'CAD', 'subject'),
      p('expenses:home:rent', '100.00', 'CAD', 'subject'),
    ])
    expect(txSubjectTotal(split, { CAD: 1 }, 'ALL')).toBeCloseTo(130, 6)
  })
})
