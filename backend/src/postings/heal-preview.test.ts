import { describe, expect, it } from 'bun:test'
import { type MalformedFinding, previewRepair } from './heal'

const finding: MalformedFinding = {
  expenseAccountId: 'food',
  expenseAccountPath: 'expenses:food',
  sourceBridgePostingId: 'p1',
  targetBridgePostingId: 'p2',
  phantomPostingId: 'p3',
  targetCurrency: 'EUR',
  sourceCurrency: 'CAD',
}

const legs = [
  { id: 'p0', accountId: 'bank', accountPath: 'assets:bank' },
  { id: 'p1', accountId: 'food', accountPath: 'expenses:food' },
  { id: 'p2', accountId: 'food', accountPath: 'expenses:food' },
  { id: 'p3', accountId: 'wallet', accountPath: 'assets:wallet:eur' },
]

describe('previewRepair', () => {
  it('moves both bridge legs to the conversion account and the phantom to the expense', () => {
    expect(previewRepair(legs, finding, { id: 'conv', path: 'equity:conversions' })).toEqual([
      { id: 'p0', accountId: 'bank', accountPath: 'assets:bank' },
      { id: 'p1', accountId: 'conv', accountPath: 'equity:conversions' },
      { id: 'p2', accountId: 'conv', accountPath: 'equity:conversions' },
      { id: 'p3', accountId: 'food', accountPath: 'expenses:food' },
    ])
  })

  it('keeps a bridge leg its own path when the conversion account has none', () => {
    expect(previewRepair(legs, finding, { id: 'conv', path: null })[1]).toEqual({
      id: 'p1',
      accountId: 'conv',
      accountPath: 'expenses:food',
    })
  })

  it('changes nothing with no conversion account to repair to', () => {
    expect(previewRepair(legs, finding, null)).toEqual(legs)
  })
})
