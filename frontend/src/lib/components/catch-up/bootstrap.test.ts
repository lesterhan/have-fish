import { describe, it, expect } from 'bun:test'
import { describeProposal, isValidProposal, proposeStartingLines } from './bootstrap'
import type { CatchUpAccount } from '$lib/api'

function account(over: Partial<CatchUpAccount> = {}): CatchUpAccount {
  return {
    accountId: 'acct-1',
    path: 'assets:chequing',
    name: null,
    state: 'unset',
    horizon: '2025-07-14',
    horizonReason: 'today',
    nextHorizonDate: null,
    coveredThrough: null,
    gap: null,
    expectedTxns: null,
    txnDatesInGap: [],
    dormant: false,
    firstTxnDate: null,
    lastTxnDate: null,
    strip: { from: '2025-04-16', to: '2025-07-14', days: 90, intervals: [], txnDates: [] },
    config: { exportMode: 'range', cycleDay: null, releaseLag: 0, tracked: true },
    ...over,
  }
}

describe('proposeStartingLines', () => {
  it('proposes the account\'s whole existing history', () => {
    const proposals = proposeStartingLines(
      [account({ firstTxnDate: '2024-03-01', lastTxnDate: '2025-06-20' })],
      '2025-07-14',
    )

    expect(proposals).toEqual([{
      accountId: 'acct-1',
      path: 'assets:chequing',
      name: null,
      fromDate: '2024-03-01',
      throughDate: '2025-06-20',
      source: 'manual',
      noHistory: false,
    }])
  })

  // An account with nothing in it still needs a starting line, or it stays 'unset' forever
  // and the bootstrap step never finishes.
  it('proposes a single empty day today for an account with no history', () => {
    const proposals = proposeStartingLines([account()], '2025-07-14')

    expect(proposals[0]).toMatchObject({
      fromDate: '2025-07-14',
      throughDate: '2025-07-14',
      source: 'empty',
      noHistory: true,
    })
  })

  it('handles an account with exactly one transaction', () => {
    const proposals = proposeStartingLines(
      [account({ firstTxnDate: '2025-05-09', lastTxnDate: '2025-05-09' })],
      '2025-07-14',
    )

    expect(proposals[0]).toMatchObject({ fromDate: '2025-05-09', throughDate: '2025-05-09', source: 'manual' })
  })

  // Only accounts with no coverage at all are asked about — anything already asserted has a
  // starting line by definition.
  it('skips accounts that already have coverage', () => {
    const proposals = proposeStartingLines([
      account({ accountId: 'set', state: 'behind', coveredThrough: '2025-06-30' }),
      account({ accountId: 'also-set', state: 'current', coveredThrough: '2025-07-14' }),
      account({ accountId: 'unset', path: 'assets:new' }),
    ], '2025-07-14')

    expect(proposals.map((p) => p.accountId)).toEqual(['unset'])
  })

  it('returns nothing when every account has a starting line', () => {
    expect(proposeStartingLines([account({ state: 'current' })], '2025-07-14')).toEqual([])
  })

  it('returns nothing for no accounts', () => {
    expect(proposeStartingLines([], '2025-07-14')).toEqual([])
  })

  it('orders proposals by account path', () => {
    const proposals = proposeStartingLines([
      account({ accountId: 'c', path: 'liabilities:visa' }),
      account({ accountId: 'a', path: 'assets:chequing' }),
      account({ accountId: 'b', path: 'assets:wise:eur' }),
    ], '2025-07-14')

    expect(proposals.map((p) => p.path)).toEqual([
      'assets:chequing', 'assets:wise:eur', 'liabilities:visa',
    ])
  })

  it('carries the display name through', () => {
    const proposals = proposeStartingLines([account({ name: 'Everyday Chequing' })], '2025-07-14')

    expect(proposals[0].name).toBe('Everyday Chequing')
  })
})

describe('isValidProposal', () => {
  it('accepts a well-formed range', () => {
    expect(isValidProposal({ fromDate: '2025-01-01', throughDate: '2025-07-14' })).toBe(true)
  })

  it('accepts a single day', () => {
    expect(isValidProposal({ fromDate: '2025-07-14', throughDate: '2025-07-14' })).toBe(true)
  })

  it('rejects an inverted range', () => {
    expect(isValidProposal({ fromDate: '2025-07-14', throughDate: '2025-01-01' })).toBe(false)
  })

  it('rejects a malformed or empty date', () => {
    expect(isValidProposal({ fromDate: '', throughDate: '2025-07-14' })).toBe(false)
    expect(isValidProposal({ fromDate: '14/07/2025', throughDate: '2025-07-14' })).toBe(false)
  })
})

describe('describeProposal', () => {
  const proposal = (over: Partial<ReturnType<typeof proposeStartingLines>[number]>) => ({
    accountId: 'a', path: 'assets:chequing', name: null,
    fromDate: '2025-01-01', throughDate: '2025-06-30',
    source: 'manual' as const, noHistory: false,
    ...over,
  })

  it('describes a span', () => {
    expect(describeProposal(proposal({}))).toBe('Marks 2025-01-01 through 2025-06-30 as covered')
  })

  it('describes a single day', () => {
    expect(describeProposal(proposal({ fromDate: '2025-06-30' })))
      .toBe('Marks 2025-06-30 as covered')
  })

  // The no-history row asserts "nothing happened here", not "this is all entered" — the copy
  // has to say so or accept-all is a leap of faith.
  it('says so when there is no history behind the row', () => {
    expect(describeProposal(proposal({ noHistory: true })))
      .toBe('No transactions yet — marks today as covered')
  })
})
