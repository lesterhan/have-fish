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

// The text of every emphasized segment, in order — what the render bolds. Only money figures
// are emphasized now; labels + currency codes ride as plain text.
const emph = (parts: BlurbParts): string[] =>
  parts.filter((s) => s.kind === 'emph').map((s) => (s.kind === 'emph' ? s.text : ''))
// The plain (un-emphasized) text, joined — where labels and the demoted currency codes live.
const plain = (parts: BlurbParts): string =>
  parts.map((s) => (s.kind === 'text' ? s.text : '')).join('')

const blurb = (postings: Posting[]): BlurbParts => blurbFor(narrateTransaction(postings))

describe('simple spend blurb', () => {
  const parts = blurb([
    p('assets:chequing', '-50.00', 'CAD', 'transfer'),
    p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
  ])

  it('reads as a sentence with the amount, category, and source', () => {
    expect(blurbText(parts)).toBe('You spent 50.00 CAD on Food · Cafe from Chequing.')
  })

  it('emphasizes only the figure — label + code ride as plain text', () => {
    expect(emph(parts)).toEqual(['50.00'])
    expect(plain(parts)).toContain(' CAD')
    expect(plain(parts)).toContain('Food · Cafe')
    expect(plain(parts)).toContain('Chequing')
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
    expect(emph(other)[0]).toBe('12.34')
  })
})

describe('split blurb', () => {
  const parts = blurb([
    p('liabilities:visa', '-30.00', 'CAD', 'transfer'),
    p('expenses:food', '20.00', 'CAD', 'subject'),
    p('assets:receivable:roommates', '10.00', 'CAD', 'share'),
  ])

  it('spells out fronted / share / owed across two lines', () => {
    expect(blurbText(parts)).toBe(
      'You fronted 30.00 CAD for Food\nYour share is 20.00 CAD, Roommates owes you 10.00 CAD.',
    )
  })

  it('breaks the two clauses onto separate lines', () => {
    expect(parts.some((s) => s.kind === 'break')).toBe(true)
  })

  it('emphasizes the three figures only — owes-you is plain prose, codes demoted', () => {
    expect(emph(parts)).toEqual(['30.00', '20.00', '10.00'])
    expect(plain(parts)).toContain('Roommates owes you ')
  })
})

describe('multi-currency blurb', () => {
  const parts = blurb([
    p('expenses:food:coffee', '360.00', 'CZK', 'subject'),
    p('assets:usd', '-17.24', 'USD', 'transfer'),
    p('equity:conversions', '-360.00', 'CZK', 'conversion'),
    p('equity:conversions', '17.24', 'USD', 'conversion'),
  ])

  it('states native spend, then the gross it was converted from — no rate, no dash', () => {
    expect(blurbText(parts)).toBe(
      'You spent 360.00 CZK on Food · Coffee.\n Which was converted from 17.24 USD.',
    )
  })

  it('emphasizes only the two figures; label + codes demoted, rate omitted', () => {
    expect(emph(parts)).toEqual(['360.00', '17.24'])
    expect(plain(parts)).toContain('Food · Coffee')
    expect(plain(parts)).toContain(' CZK')
    expect(plain(parts)).toContain(' USD')
    expect(blurbText(parts)).not.toContain('CZK/USD')
  })
})

describe('inflow blurb', () => {
  it('income reads as money coming in', () => {
    const parts = blurb([
      p('assets:chequing', '2000.00', 'CAD', 'transfer'),
      p('income:salary', '-2000.00', 'CAD', 'subject'),
    ])
    expect(blurbText(parts)).toBe('2000.00 CAD came into Chequing for Salary.')
    expect(emph(parts)).toEqual(['2000.00'])
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
