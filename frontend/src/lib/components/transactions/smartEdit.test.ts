import { describe, it, expect } from 'bun:test'
import {
  canSmartEdit,
  recategorizableLegs,
  initialSubjectDrafts,
  hasAccountChange,
  buildRecategorizePayload,
} from './smartEdit'
import type { Posting, PostingRole } from '$lib/api'

// Build a posting; id derived from accountPath so fixtures stay terse. accountId == path
// here so payload assertions read clearly.
function p(
  accountPath: string,
  amount: string,
  currency: string,
  role: PostingRole,
  id = accountPath + ':' + amount,
): Posting {
  return { id, accountId: accountPath, accountPath, amount, currency, role }
}

// The canonical fee-bearing cross-currency Wise spend: only the cafe leg is a subject.
function wiseSpend(): Posting[] {
  return [
    p('assets:wise:cad', '-80.00', 'CAD', 'transfer'),
    p('assets:wise:eur', '50.00', 'EUR', 'transfer'),
    p('equity:conversion', '80.00', 'CAD', 'conversion'),
    p('expenses:banking:fee', '0.05', 'EUR', 'fee'),
    p('expenses:food:cafe', '50.00', 'EUR', 'subject'),
  ]
}

describe('canSmartEdit', () => {
  it('true when there is a subject leg to recategorize', () => {
    expect(canSmartEdit(wiseSpend())).toBe(true)
    expect(
      canSmartEdit([
        p('assets:chequing', '-50.00', 'CAD', 'transfer'),
        p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
      ]),
    ).toBe(true)
  })

  it('false for a subject-less shape (pure transfer / opening balance)', () => {
    expect(
      canSmartEdit([
        p('assets:savings', '1000.00', 'CAD', 'transfer'),
        p('equity:opening-balances', '-1000.00', 'CAD', 'conversion'),
      ]),
    ).toBe(false)
    expect(canSmartEdit([])).toBe(false)
  })
})

describe('recategorizableLegs / initialSubjectDrafts', () => {
  it('exposes only the subject legs of a complex transaction', () => {
    expect(recategorizableLegs(wiseSpend()).map((s) => s.accountPath)).toEqual([
      'expenses:food:cafe',
    ])
  })

  it('seeds one draft per subject, defaulting to the leg account', () => {
    expect(initialSubjectDrafts(wiseSpend())).toEqual([
      { postingId: 'expenses:food:cafe:50.00', accountId: 'expenses:food:cafe' },
    ])
  })

  it('seeds a draft per subject for a two-category split', () => {
    const drafts = initialSubjectDrafts([
      p('assets:chequing', '-75.00', 'CAD', 'transfer'),
      p('expenses:food:groceries', '50.00', 'CAD', 'subject'),
      p('expenses:home:supplies', '25.00', 'CAD', 'subject'),
    ])
    expect(drafts.map((d) => d.accountId)).toEqual([
      'expenses:food:groceries',
      'expenses:home:supplies',
    ])
  })
})

describe('hasAccountChange', () => {
  const tx = wiseSpend()

  it('false when the draft still points at the original account', () => {
    expect(hasAccountChange(tx, initialSubjectDrafts(tx))).toBe(false)
  })

  it('true once a subject is repointed', () => {
    expect(
      hasAccountChange(tx, [
        { postingId: 'expenses:food:cafe:50.00', accountId: 'expenses:food:restaurants' },
      ]),
    ).toBe(true)
  })

  it('false for a blank draft (treated as unchanged)', () => {
    expect(
      hasAccountChange(tx, [
        { postingId: 'expenses:food:cafe:50.00', accountId: '   ' },
      ]),
    ).toBe(false)
  })
})

describe('buildRecategorizePayload', () => {
  it('repoints only the subject leg; every other leg + all amounts untouched', () => {
    const tx = wiseSpend()
    const payload = buildRecategorizePayload(tx, [
      { postingId: 'expenses:food:cafe:50.00', accountId: 'expenses:food:restaurants' },
    ])
    expect(payload).toEqual([
      { accountId: 'assets:wise:cad', amount: '-80.00', currency: 'CAD' },
      { accountId: 'assets:wise:eur', amount: '50.00', currency: 'EUR' },
      { accountId: 'equity:conversion', amount: '80.00', currency: 'CAD' },
      { accountId: 'expenses:banking:fee', amount: '0.05', currency: 'EUR' },
      { accountId: 'expenses:food:restaurants', amount: '50.00', currency: 'EUR' },
    ])
  })

  it('preserves every leg amount + currency exactly (so balance is untouched)', () => {
    const tx = wiseSpend()
    const payload = buildRecategorizePayload(tx, [
      { postingId: 'expenses:food:cafe:50.00', accountId: 'expenses:food:restaurants' },
    ])
    expect(payload.map((l) => `${l.amount} ${l.currency}`)).toEqual(
      tx.map((p) => `${p.amount} ${p.currency}`),
    )
  })

  it('ignores a draft targeting a non-subject (mechanical) leg', () => {
    const tx = wiseSpend()
    const payload = buildRecategorizePayload(tx, [
      // Attempt to repoint the fee leg — not a subject, must be ignored.
      { postingId: 'expenses:banking:fee:0.05', accountId: 'assets:hacked' },
    ])
    expect(payload.find((l) => l.amount === '0.05')?.accountId).toBe('expenses:banking:fee')
  })

  it('blank draft falls back to the current account', () => {
    const tx = wiseSpend()
    const payload = buildRecategorizePayload(tx, [
      { postingId: 'expenses:food:cafe:50.00', accountId: '' },
    ])
    // The cafe leg is the last posting; payload preserves order.
    expect(payload[payload.length - 1].accountId).toBe('expenses:food:cafe')
  })
})
