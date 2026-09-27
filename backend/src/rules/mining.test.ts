import { describe, expect, it } from 'bun:test'
import { merchantKey } from '../import/merchant'
import { DEFAULT_ROOTS } from '../postings/account-type'
import type { ClassifySettings, RolePosting } from '../postings/roles'
import { expenseLegs, mineSuggestions } from './mining'

// No database: the service loads the legs; this is what they suggest.

const FEE = 'fee'
const settings: ClassifySettings = {
  roots: { ...DEFAULT_ROOTS, tagged: new Map() },
  feeAccountIds: new Set([FEE]),
  conversionAccountIds: new Set(),
  clearingPrefix: 'assets:receivable',
}

const leg = (accountId: string, accountPath: string, accountType: string | null = null) =>
  ({ accountId, accountPath, accountType }) satisfies RolePosting

const spend = (description: string | null, expense: string, path = `expenses:${expense}`) => ({
  description,
  postings: [leg('bank', 'assets:bank'), leg(expense, path)],
})

describe('expenseLegs', () => {
  it('prefers the spend over a fee leg, but keeps a fee-only transaction', () => {
    const withFee = [
      leg('bank', 'assets:bank'),
      leg('food', 'expenses:food'),
      leg(FEE, 'expenses:fees'),
    ]
    expect(expenseLegs(withFee, settings).map((l) => l.accountId)).toEqual(['food'])
    const feeOnly = [leg('bank', 'assets:bank'), leg(FEE, 'expenses:fees')]
    expect(expenseLegs(feeOnly, settings).map((l) => l.accountId)).toEqual([FEE])
  })

  it('counts a tagged expense at an atypical root, and never a clearing leg', () => {
    expect(expenseLegs([leg('x', '花钱:午饭', 'expense')], settings)).toHaveLength(1)
    expect(expenseLegs([leg('r', 'assets:receivable:trip', 'expense')], settings)).toEqual([])
  })
})

describe('mineSuggestions', () => {
  it('suggests a pattern seen twice, keyed the way the preview keys it', () => {
    const txs = [spend('Blue Bottle Coffee', 'coffee'), spend('BLUE BOTTLE COFFEE', 'coffee')]
    expect(mineSuggestions(txs, settings, new Set())).toEqual([
      { pattern: merchantKey('Blue Bottle Coffee'), accountId: 'coffee', count: 2 },
    ])
  })

  it('does not suggest a pattern seen once', () => {
    expect(mineSuggestions([spend('Once Only', 'misc')], settings, new Set())).toEqual([])
  })

  it('keeps the account a pattern went to most often', () => {
    const txs = [
      spend('Corner Store', 'groceries'),
      spend('Corner Store', 'snacks'),
      spend('Corner Store', 'snacks'),
    ]
    expect(mineSuggestions(txs, settings, new Set()).map((s) => [s.accountId, s.count])).toEqual([
      ['snacks', 2],
    ])
  })

  it('skips a covered pattern, whatever its case', () => {
    const txs = [spend('Corner Store', 'snacks'), spend('Corner Store', 'snacks')]
    const covered = new Set([merchantKey('Corner Store').toLowerCase()])
    expect(mineSuggestions(txs, settings, covered)).toEqual([])
  })

  it('skips transactions with no description, or with no or several expense legs', () => {
    const two = {
      description: 'Split Dinner',
      postings: [leg('bank', 'assets:bank'), leg('a', 'expenses:a'), leg('b', 'expenses:b')],
    }
    const none = {
      description: 'Transfer',
      postings: [leg('bank', 'assets:bank'), leg('s', 'assets:savings')],
    }
    const txs = [two, two, none, none, spend(null, 'x'), spend(null, 'x')]
    expect(mineSuggestions(txs, settings, new Set())).toEqual([])
  })
})
