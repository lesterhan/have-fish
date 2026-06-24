import { describe, it, expect } from 'bun:test'
import { classifyPosting, classifyPostings, isExpenseSubject, type ClassifySettings } from './roles'
import { DEFAULT_ROOTS } from './account-type'

const FEE = 'fee-account-id'
const CONV = 'conversion-account-id'

const settings: ClassifySettings = {
  roots: DEFAULT_ROOTS,
  feeAccountIds: new Set([FEE]),
  conversionAccountIds: new Set([CONV]),
  clearingPrefix: 'assets:receivable',
}

// Builds a posting with a synthetic id so classifyPostings can key it.
const p = (accountId: string, accountPath: string) => ({ id: accountPath, accountId, accountPath })

describe('classifyPosting', () => {
  it('plain 2-leg spend: expense → subject, asset → transfer', () => {
    expect(classifyPosting(p('a1', 'expenses:food:cafe'), settings)).toBe('subject')
    expect(classifyPosting(p('a2', 'assets:chequing'), settings)).toBe('transfer')
  })

  it('income leg is a subject (covers a paycheck, not just expenses)', () => {
    expect(classifyPosting(p('a3', 'income:salary'), settings)).toBe('subject')
  })

  it('liability leg is a transfer (paying a credit card moves money)', () => {
    expect(classifyPosting(p('a4', 'liabilities:visa'), settings)).toBe('transfer')
  })

  it('equity leg is a conversion (FX rate-balancing)', () => {
    expect(classifyPosting(p('a5', 'equity:conversion'), settings)).toBe('conversion')
  })

  it('configured conversion account wins over its expense/equity path', () => {
    // Even if the conversion account were pathed under expenses, the explicit id wins.
    expect(classifyPosting(p(CONV, 'expenses:misc'), settings)).toBe('conversion')
  })

  it('configured fee account is a fee, not a subject, despite living under expenses', () => {
    expect(classifyPosting(p(FEE, 'expenses:banking:fee'), settings)).toBe('fee')
  })

  it('Fish Pie clearing leg is a share', () => {
    expect(classifyPosting(p('a6', 'assets:receivable:roommates'), settings)).toBe('share')
  })

  it('unknown root falls back to transfer (never inflates the spend sum)', () => {
    expect(classifyPosting(p('a7', '花钱:房租'), settings)).toBe('transfer')
    expect(classifyPosting(p('a8', 'uncategorized'), settings)).toBe('transfer')
  })
})

describe('classifyPostings — canonical shapes', () => {
  it('classifies a fee-bearing cross-currency Wise spend by leg', () => {
    // assets:wise:cad → assets:wise:eur, equity:conversion bridge, fee, the actual spend.
    const legs = [
      { id: 'l1', accountId: 'w-cad', accountPath: 'assets:wise:cad' },
      { id: 'l2', accountId: 'w-eur', accountPath: 'assets:wise:eur' },
      { id: 'l3', accountId: CONV, accountPath: 'equity:conversion' },
      { id: 'l4', accountId: FEE, accountPath: 'expenses:banking:fee' },
      { id: 'l5', accountId: 'cafe', accountPath: 'expenses:food:cafe' },
    ]
    const roles = classifyPostings(legs, settings)
    expect(roles.get('l1')).toBe('transfer')
    expect(roles.get('l2')).toBe('transfer')
    expect(roles.get('l3')).toBe('conversion')
    expect(roles.get('l4')).toBe('fee')
    expect(roles.get('l5')).toBe('subject')
  })

  it('classifies a Fish Pie 3-leg split', () => {
    const legs = [
      { id: 'l1', accountId: 'visa', accountPath: 'liabilities:visa' },
      { id: 'l2', accountId: 'food', accountPath: 'expenses:food' },
      { id: 'l3', accountId: 'recv', accountPath: 'assets:receivable:roommates' },
    ]
    const roles = classifyPostings(legs, settings)
    expect(roles.get('l1')).toBe('transfer')
    expect(roles.get('l2')).toBe('subject')
    expect(roles.get('l3')).toBe('share')
  })

  it('tolerates a malformed cross-currency spend without crashing', () => {
    // The broken shape: the expense account reused as the FX bridge in both currencies,
    // the spend dumped into a balance account. Per-leg classification still returns a role
    // for every leg (it cannot tell the bridge is disguised — heal epic's job).
    const legs = [
      { id: 'l1', accountId: 'usd', accountPath: 'assets:bank:usd' },
      { id: 'l2', accountId: 'coffee', accountPath: 'expenses:food:coffee' },
      { id: 'l3', accountId: 'coffee', accountPath: 'expenses:food:coffee' },
      { id: 'l4', accountId: 'czk', accountPath: 'assets:bank:czk' },
    ]
    const roles = classifyPostings(legs, settings)
    expect(roles.size).toBe(4)
    expect([...roles.values()].every((r) => r !== undefined)).toBe(true)
  })
})

describe('isExpenseSubject', () => {
  it('true only for expense-type subject legs', () => {
    expect(isExpenseSubject(p('a', 'expenses:food:cafe'), settings)).toBe(true)
    // income is a subject but not an expense → excluded from the spending total
    expect(isExpenseSubject(p('a', 'income:salary'), settings)).toBe(false)
    // mechanical legs are never spend
    expect(isExpenseSubject(p('a', 'assets:chequing'), settings)).toBe(false)
    expect(isExpenseSubject(p(FEE, 'expenses:banking:fee'), settings)).toBe(false)
    expect(isExpenseSubject(p(CONV, 'equity:conversion'), settings)).toBe(false)
  })
})
