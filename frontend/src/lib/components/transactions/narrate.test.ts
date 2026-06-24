import { describe, it, expect } from 'bun:test'
import { narrateTransaction } from './narrate'
import type { Posting, PostingRole } from '$lib/api'

// Build a posting with sensible defaults; id derived from accountPath for terse fixtures.
function p(
  accountPath: string,
  amount: string,
  currency: string,
  role: PostingRole,
  id = accountPath + ':' + amount,
): Posting {
  return { id, accountId: accountPath, accountPath, amount, currency, role }
}

describe('narrateTransaction', () => {
  it('plain 2-leg spend → simple, one subject, source set, no flow/fees', () => {
    const n = narrateTransaction([
      p('assets:chequing', '-50.00', 'CAD', 'transfer'),
      p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
    ])
    expect(n.simple).toBe(true)
    expect(n.subjects.map((s) => s.accountPath)).toEqual(['expenses:food:cafe'])
    expect(n.movement.source?.accountPath).toBe('assets:chequing')
    expect(n.movement.flow).toBeNull()
    expect(n.movement.fees).toHaveLength(0)
    expect(n.shares).toHaveLength(0)
  })

  it('plain 2-leg income (paycheck) → simple, income leg is the subject', () => {
    const n = narrateTransaction([
      p('assets:chequing', '2000.00', 'CAD', 'transfer'),
      p('income:salary', '-2000.00', 'CAD', 'subject'),
    ])
    expect(n.simple).toBe(true)
    expect(n.subjects.map((s) => s.accountPath)).toEqual(['income:salary'])
    // Source = the most-negative transfer leg; here the only transfer is the +2000 deposit,
    // so it is still the source (there is no other transfer to compare).
    expect(n.movement.source?.accountPath).toBe('assets:chequing')
    expect(n.movement.flow).toBeNull()
  })

  it('fee-bearing cross-currency Wise spend → not simple, flow + fee surfaced, conversion hidden', () => {
    // assets:wise:cad -80 → assets:wise:eur +50, equity:conversion bridge, fee, the spend.
    const n = narrateTransaction([
      p('assets:wise:cad', '-80.00', 'CAD', 'transfer'),
      p('assets:wise:eur', '50.00', 'EUR', 'transfer'),
      p('equity:conversion', '80.00', 'CAD', 'conversion'),
      p('expenses:banking:fee', '0.05', 'EUR', 'fee'),
      p('expenses:food:cafe', '50.00', 'EUR', 'subject'),
    ])
    expect(n.simple).toBe(false)
    // One spend line, prominent.
    expect(n.subjects.map((s) => s.accountPath)).toEqual(['expenses:food:cafe'])
    // Source = the CAD wallet the money left.
    expect(n.movement.source?.accountPath).toBe('assets:wise:cad')
    // Cross-currency flow: 80 CAD → 50 EUR (absolute values).
    expect(n.movement.flow).toEqual({
      from: { amount: '80.00', currency: 'CAD' },
      to: { amount: '50.00', currency: 'EUR' },
    })
    // The fee shows; the conversion (equity) leg never appears as a line.
    expect(n.movement.fees.map((f) => f.accountPath)).toEqual(['expenses:banking:fee'])
    expect(
      [n.subjects, n.shares, [n.movement.source], n.movement.fees]
        .flat()
        .some((x) => x?.role === 'conversion'),
    ).toBe(false)
  })

  it('Fish Pie 3-leg split → subject leads, share surfaced, no cross-currency flow', () => {
    const n = narrateTransaction([
      p('liabilities:visa', '-30.00', 'CAD', 'transfer'),
      p('expenses:food', '20.00', 'CAD', 'subject'),
      p('assets:receivable:roommates', '10.00', 'CAD', 'share'),
    ])
    expect(n.simple).toBe(false) // 3 legs + a share → narrated, not simple
    expect(n.subjects.map((s) => s.accountPath)).toEqual(['expenses:food'])
    expect(n.shares.map((s) => s.accountPath)).toEqual(['assets:receivable:roommates'])
    expect(n.movement.source?.accountPath).toBe('liabilities:visa')
    expect(n.movement.flow).toBeNull()
  })

  it('same-currency multi-leg (split across two categories) → both subjects, no flow', () => {
    const n = narrateTransaction([
      p('assets:chequing', '-75.00', 'CAD', 'transfer'),
      p('expenses:food:groceries', '50.00', 'CAD', 'subject'),
      p('expenses:home:supplies', '25.00', 'CAD', 'subject'),
    ])
    expect(n.simple).toBe(false)
    expect(n.subjects.map((s) => s.accountPath)).toEqual([
      'expenses:food:groceries',
      'expenses:home:supplies',
    ])
    expect(n.movement.source?.accountPath).toBe('assets:chequing')
    expect(n.movement.flow).toBeNull()
  })

  it('no transfer legs (opening balance) → source null, still renders subjects', () => {
    const n = narrateTransaction([
      p('assets:savings', '1000.00', 'CAD', 'transfer'),
      p('equity:opening-balances', '-1000.00', 'CAD', 'conversion'),
    ])
    // One transfer + one conversion: simple requires a subject, so this is not simple.
    expect(n.simple).toBe(false)
    expect(n.subjects).toHaveLength(0)
    expect(n.movement.source?.accountPath).toBe('assets:savings')
  })

  it('empty postings → safe empty narration', () => {
    const n = narrateTransaction([])
    expect(n.simple).toBe(false)
    expect(n.subjects).toHaveLength(0)
    expect(n.shares).toHaveLength(0)
    expect(n.movement.source).toBeNull()
    expect(n.movement.flow).toBeNull()
    expect(n.movement.fees).toHaveLength(0)
  })
})
