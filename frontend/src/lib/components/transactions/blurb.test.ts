import { describe, it, expect } from 'bun:test'
import { blurbFor, blurbText, blurbTemplates, type BlurbParts } from './blurb'
import { narrateTransaction } from './narration'
import type { Posting, PostingRole } from '$lib/api'

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

// The text of every emphasized segment, in order — what the render bolds.
const emph = (parts: BlurbParts): string[] =>
  parts.filter((s) => s.kind === 'emph').map((s) => s.text)
const accent = (parts: BlurbParts): string[] =>
  parts.filter((s) => s.kind === 'accent').map((s) => s.text)

const blurb = (postings: Posting[]): BlurbParts => blurbFor(narrateTransaction(postings))

describe('simple spend blurb', () => {
  const parts = blurb([
    p('assets:chequing', '-50.00', 'CAD', 'transfer'),
    p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
  ])

  it('reads as a sentence with the amount, category, and source', () => {
    expect(blurbText(parts)).toBe('You spent 50.00 CAD on Food · Cafe from Chequing.')
  })

  it('emphasizes the amount, category, and source — numbers from the tx', () => {
    expect(emph(parts)).toEqual(['50.00 CAD', 'Food · Cafe', 'Chequing'])
  })

  it('uses the friendly account name when set', () => {
    const named = blurb([
      p('assets:chequing', '-50.00', 'CAD', 'transfer', 'Daily'),
      p('expenses:food:cafe', '50.00', 'CAD', 'subject', 'Morning Coffee'),
    ])
    expect(blurbText(named)).toBe('You spent 50.00 CAD on Morning Coffee from Daily.')
  })

  it('amount tracks the transaction, not a literal', () => {
    const other = blurb([
      p('assets:chequing', '-12.34', 'CAD', 'transfer'),
      p('expenses:food:cafe', '12.34', 'CAD', 'subject'),
    ])
    expect(emph(other)[0]).toBe('12.34 CAD')
  })
})

describe('split blurb', () => {
  const parts = blurb([
    p('liabilities:visa', '-30.00', 'CAD', 'transfer'),
    p('expenses:food', '20.00', 'CAD', 'subject'),
    p('assets:receivable:roommates', '10.00', 'CAD', 'share'),
  ])

  it('spells out fronted / share / owed', () => {
    expect(blurbText(parts)).toBe(
      'You fronted 30.00 CAD for Food. Your share is 20.00 CAD; Roommates owes you 10.00 CAD.',
    )
  })

  it('puts the owes-you relationship in an accent span', () => {
    expect(accent(parts)).toEqual(['Roommates owes you 10.00 CAD'])
  })

  it('emphasizes fronted total, category, and share', () => {
    expect(emph(parts)).toEqual(['30.00 CAD', 'Food', '20.00 CAD'])
  })
})

describe('multi-currency blurb', () => {
  const parts = blurb([
    p('expenses:food:coffee', '360.00', 'CZK', 'subject'),
    p('assets:usd', '-17.24', 'USD', 'transfer'),
    p('equity:conversions', '-360.00', 'CZK', 'conversion'),
    p('equity:conversions', '17.24', 'USD', 'conversion'),
  ])

  it('states native spend, paid amount, and rate', () => {
    expect(blurbText(parts)).toBe(
      'You spent 360.00 CZK on Food · Coffee — 17.24 USD at 20.88 CZK/USD.',
    )
  })

  it('emphasizes native, category, paid, and rate — all from the bridge legs', () => {
    expect(emph(parts)).toEqual(['360.00 CZK', 'Food · Coffee', '17.24 USD', '20.88 CZK/USD'])
  })
})

describe('inflow blurb', () => {
  it('income reads as money coming in', () => {
    const parts = blurb([
      p('assets:chequing', '2000.00', 'CAD', 'transfer'),
      p('income:salary', '-2000.00', 'CAD', 'subject'),
    ])
    expect(blurbText(parts)).toBe('2000.00 CAD came into Chequing for Salary.')
    expect(emph(parts)).toEqual(['2000.00 CAD', 'Chequing', 'Salary'])
  })

  it('refund magnitude is positive in the copy despite the negative subject', () => {
    const parts = blurb([
      p('assets:chequing', '10.00', 'CAD', 'transfer'),
      p('expenses:food:cafe', '-10.00', 'CAD', 'subject'),
    ])
    expect(blurbText(parts)).toBe('10.00 CAD came into Chequing for Food · Cafe.')
  })
})

describe('robustness', () => {
  it('dispatches on archetype via the templates map', () => {
    const n = narrateTransaction([
      p('assets:chequing', '-50.00', 'CAD', 'transfer'),
      p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
    ])
    expect(blurbFor(n)).toEqual(blurbTemplates[n.archetype](n))
  })

  it('subject-less shape (opening balance) → safe sentence, no throw', () => {
    const parts = blurb([
      p('assets:savings', '1000.00', 'CAD', 'transfer'),
      p('equity:opening-balances', '-1000.00', 'CAD', 'conversion'),
    ])
    expect(blurbText(parts)).toBe('A transfer with no spend category.')
  })

  it('empty postings → no throw', () => {
    expect(() => blurb([])).not.toThrow()
  })
})
