import { describe, it, expect } from 'bun:test'
import {
  currentSummary,
  expectedForDisplay,
  displayName,
  donePanelCopy,
  emptyActionLabel,
  enteredInGapNote,
  focusPosition,
  gapSummary,
  groupAccounts,
  importHref,
  resolveFocus,
  progressLabel,
  progressPercent,
} from './hub'
import type { CatchUpAccount } from '$lib/api'

function account(over: Partial<CatchUpAccount> = {}): CatchUpAccount {
  return {
    accountId: 'acct-1',
    path: 'assets:chequing',
    name: null,
    state: 'behind',
    horizon: '2025-07-14',
    horizonReason: 'today',
    nextHorizonDate: null,
    coveredThrough: '2025-06-30',
    gap: { from: '2025-07-01', through: '2025-07-14', days: 14 },
    expectedTxns: 18,
    txnDatesInGap: [],
    dormant: false,
    firstTxnDate: null,
    lastTxnDate: null,
    strip: { from: '2025-04-16', to: '2025-07-14', days: 90, intervals: [], txnDates: [] },
    config: { exportMode: 'range', cycleDay: null, releaseLag: 0, tracked: true },
    ...over,
  }
}

describe('groupAccounts', () => {
  it('splits behind, current and dormant', () => {
    const groups = groupAccounts([
      account({ accountId: 'a', state: 'behind' }),
      account({ accountId: 'b', state: 'current', gap: null }),
      account({ accountId: 'c', state: 'behind', dormant: true }),
    ])

    expect(groups.behind.map((a) => a.accountId)).toEqual(['a'])
    expect(groups.current.map((a) => a.accountId)).toEqual(['b'])
    expect(groups.dormant.map((a) => a.accountId)).toEqual(['c'])
  })

  // Dormancy is a ranking signal, not a filter — a dormant account with a real gap is still
  // shown, just last.
  it('files a dormant account under dormant whatever its state', () => {
    const groups = groupAccounts([
      account({ accountId: 'quiet-current', state: 'current', gap: null, dormant: true }),
    ])

    expect(groups.current).toEqual([])
    expect(groups.dormant).toHaveLength(1)
  })

  // The server already ordered smallest-gap-first; grouping must not second-guess it.
  it('preserves the order it was given', () => {
    const groups = groupAccounts([
      account({ accountId: 'small', gap: { from: 'a', through: 'b', days: 2 } }),
      account({ accountId: 'mid', gap: { from: 'a', through: 'b', days: 20 } }),
      account({ accountId: 'big', gap: { from: 'a', through: 'b', days: 90 } }),
    ])

    expect(groups.behind.map((a) => a.accountId)).toEqual(['small', 'mid', 'big'])
  })

  it('handles an empty list', () => {
    expect(groupAccounts([])).toEqual({ behind: [], current: [], dormant: [] })
  })
})

describe('displayName', () => {
  it('prefers the display name', () => {
    expect(displayName(account({ name: 'Everyday Chequing' }))).toBe('Everyday Chequing')
  })

  it('falls back to the path', () => {
    expect(displayName(account())).toBe('assets:chequing')
  })
})

describe('gapSummary', () => {
  it('states days and the transaction estimate', () => {
    expect(gapSummary(account())).toBe('14 days · ~18 transactions')
  })

  it('singularises a one-day gap', () => {
    expect(gapSummary(account({ gap: { from: 'a', through: 'b', days: 1 }, expectedTxns: 1 })))
      .toBe('1 day · ~1 transaction')
  })

  // An honest "we don't know yet" beats a confident zero.
  it('omits the estimate when there is not enough history for one', () => {
    expect(gapSummary(account({ expectedTxns: null }))).toBe('14 days')
  })

  it('keeps a zero estimate when the gap really is empty', () => {
    expect(gapSummary(account({ expectedTxns: 0 }))).toBe('14 days · ~0 transactions')
  })

  // The dangerous contradiction: "~0 transactions" sitting directly above a button that marks
  // the whole range covered, on a gap that visibly holds entered days.
  it('never estimates below the days already holding transactions', () => {
    expect(gapSummary(account({ expectedTxns: 0, txnDatesInGap: ['2025-07-02', '2025-07-09'] })))
      .toBe('14 days · ~2 transactions')
  })

  it('is null with no gap', () => {
    expect(gapSummary(account({ gap: null }))).toBeNull()
  })
})

describe('expectedForDisplay', () => {
  it('passes a healthy estimate through', () => {
    expect(expectedForDisplay(account({ expectedTxns: 18, txnDatesInGap: ['2025-07-02'] }))).toBe(18)
  })

  it('floors at the days already holding transactions', () => {
    expect(expectedForDisplay(account({
      expectedTxns: 1, txnDatesInGap: ['2025-07-02', '2025-07-05', '2025-07-09'],
    }))).toBe(3)
  })

  // Null means "not enough history to guess", which is not the same as a low number and must
  // not be turned into one.
  it('stays null when there is no estimate to make', () => {
    expect(expectedForDisplay(account({ expectedTxns: null, txnDatesInGap: ['2025-07-02'] }))).toBeNull()
  })
})

describe('currentSummary', () => {
  it('is plain for an account that exports on demand', () => {
    expect(currentSummary(account({ state: 'current', gap: null }))).toBe('Current')
  })

  // A card sitting at "current" for three weeks should explain itself rather than look stalled.
  it('names the next statement for a cycle account', () => {
    expect(currentSummary(account({
      state: 'current', gap: null, horizonReason: 'statement', nextHorizonDate: '2025-08-25',
    }))).toBe('Current · next statement 2025-08-25')
  })

  it('stays plain when a cycle account has no next date', () => {
    expect(currentSummary(account({ horizonReason: 'statement', nextHorizonDate: null }))).toBe('Current')
  })
})

describe('emptyActionLabel', () => {
  it('spells out what the action would assert', () => {
    expect(emptyActionLabel(account())).toBe('Marks 2025-07-01 through 2025-07-14 as covered')
  })

  it('is null with no gap to cover', () => {
    expect(emptyActionLabel(account({ gap: null }))).toBeNull()
  })
})

describe('enteredInGapNote', () => {
  it('counts the days already holding transactions', () => {
    expect(enteredInGapNote(account({ txnDatesInGap: ['2025-07-02', '2025-07-09'] })))
      .toBe('2 days in this range already have transactions')
  })

  it('singularises one day', () => {
    expect(enteredInGapNote(account({ txnDatesInGap: ['2025-07-02'] })))
      .toBe('1 day in this range already has transactions')
  })

  it('is null when the gap is empty', () => {
    expect(enteredInGapNote(account())).toBeNull()
  })
})

describe('progress', () => {
  it('reports a percentage', () => {
    expect(progressPercent(1, 4)).toBe(25)
    expect(progressPercent(3, 4)).toBe(75)
    expect(progressPercent(4, 4)).toBe(100)
    expect(progressPercent(0, 4)).toBe(0)
  })

  // A user with nothing to track is not 0% done — an empty bar would invent a job.
  it('reads complete when there is nothing to track', () => {
    expect(progressPercent(0, 0)).toBe(100)
    expect(progressLabel(0, 0)).toBe('Nothing to track yet')
  })

  it('counts accounts, never days', () => {
    expect(progressLabel(1, 4)).toBe('1 of 4 accounts current')
  })

  it('says so plainly when everything is current', () => {
    expect(progressLabel(4, 4)).toBe('Ledger current')
  })
})

describe('donePanelCopy', () => {
  const groups = (dormant: CatchUpAccount[] = []) => ({ behind: [], current: [], dormant })

  it('says everything is caught up when nothing is left uncovered', () => {
    expect(donePanelCopy(groups()).headline).toBe('Everything is caught up.')
  })

  it('ignores a dormant account that is itself current', () => {
    expect(donePanelCopy(groups([account({ state: 'current', gap: null, dormant: true })])).headline)
      .toBe('Everything is caught up.')
  })

  // Claiming "everything is caught up" beside a progress bar reading 2 of 3 is a plain
  // contradiction — but blocking the calm panel until a permanently quiet account is covered
  // would nag forever.
  it('is honest when quiet accounts are still uncovered', () => {
    const copy = donePanelCopy(groups([account({ dormant: true })]))

    expect(copy.headline).toBe('Nothing active to catch up.')
    expect(copy.note).toBe('1 quiet account is still uncovered, waiting below whenever you want it.')
  })

  it('pluralises several parked accounts', () => {
    const copy = donePanelCopy(groups([
      account({ accountId: 'a', dormant: true }),
      account({ accountId: 'b', dormant: true }),
    ]))

    expect(copy.note).toContain('2 quiet accounts are still uncovered')
  })
})

describe('resolveFocus', () => {
  const queue = [
    account({ accountId: 'a' }),
    account({ accountId: 'b' }),
    account({ accountId: 'c' }),
  ]

  it('starts at the top with nothing remembered', () => {
    expect(resolveFocus(queue, null)).toBe(0)
  })

  it('resumes on the remembered account', () => {
    expect(resolveFocus(queue, 'b')).toBe(1)
  })

  // A finished import removes that account from the queue, so by-id resume falls through
  // rather than pointing at whatever slid into its index.
  it('falls back to the top when the remembered account is gone', () => {
    expect(resolveFocus(queue, 'finished')).toBe(0)
  })

  it('reports no focus for an empty queue', () => {
    expect(resolveFocus([], 'b')).toBe(-1)
    expect(resolveFocus([], null)).toBe(-1)
  })
})

describe('focusPosition', () => {
  it('is one-based', () => {
    expect(focusPosition(0, 5)).toBe('1 of 5')
    expect(focusPosition(4, 5)).toBe('5 of 5')
  })
})

describe('importHref', () => {
  // The range ends at the horizon, not today — asking a bank for days it has not published
  // is asking for a file that cannot exist.
  it('carries the account, its gap and the return path', () => {
    const href = importHref(account({
      accountId: 'acct-9',
      gap: { from: '2025-07-01', through: '2025-07-25', days: 25 },
    }))
    const params = new URLSearchParams(href.split('?')[1])

    expect(href.startsWith('/import?')).toBe(true)
    expect(params.get('account')).toBe('acct-9')
    expect(params.get('from')).toBe('2025-07-01')
    expect(params.get('to')).toBe('2025-07-25')
    expect(params.get('return')).toBe('catch-up')
  })

  it('omits the range when there is no gap', () => {
    const params = new URLSearchParams(importHref(account({ gap: null })).split('?')[1])

    expect(params.get('from')).toBeNull()
    expect(params.get('to')).toBeNull()
    expect(params.get('account')).toBe('acct-1')
  })
})
