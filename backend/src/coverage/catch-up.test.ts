import { describe, it, expect } from 'bun:test'
import { assembleAccount, sortAccounts, summarize, type CatchUpAccountInput } from './catch-up'
import { DEFAULT_CONFIG, type CoverageConfig } from './horizon'

const RANGE: CoverageConfig = DEFAULT_CONFIG
const CYCLE_25: CoverageConfig = { exportMode: 'cycle', cycleDay: 25, releaseLag: 0, tracked: true }

const iv = (fromDate: string, throughDate: string) => ({ fromDate, throughDate })

function input(overrides: Partial<CatchUpAccountInput> = {}): CatchUpAccountInput {
  return {
    accountId: 'acct-1',
    path: 'assets:chequing',
    name: null,
    config: RANGE,
    intervals: [],
    txnCountsByDate: {},
    ...overrides,
  }
}

// Spreads one transaction per day across an inclusive range, so a covered stretch has a
// believable rate rather than a single spike.
function dailyTxns(from: string, days: number, perDay = 1): Record<string, number> {
  const counts: Record<string, number> = {}
  const start = new Date(`${from}T00:00:00Z`)
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    counts[d.toISOString().substring(0, 10)] = perDay
  }
  return counts
}

describe('assembleAccount', () => {
  describe('state', () => {
    it('is unset when no coverage has ever been asserted', () => {
      const result = assembleAccount(input(), '2025-07-14')

      expect(result.state).toBe('unset')
      expect(result.coveredThrough).toBeNull()
      expect(result.gap).toBeNull()
      expect(result.expectedTxns).toBeNull()
    })

    it('is current when covered through today on a range account', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-06-01', '2025-07-14')] }),
        '2025-07-14',
      )

      expect(result.state).toBe('current')
      expect(result.gap).toBeNull()
    })

    it('is behind when coverage stops short of today', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-06-01', '2025-06-30')] }),
        '2025-07-14',
      )

      expect(result.state).toBe('behind')
      expect(result.coveredThrough).toBe('2025-06-30')
      expect(result.gap).toEqual({ from: '2025-07-01', through: '2025-07-14', days: 14 })
    })

    // The whole point of the horizon: a card covered to its last statement is finished, even
    // though three weeks of today-relative days are uncovered.
    it('is current when covered exactly to a cycle horizon', () => {
      const result = assembleAccount(
        input({ config: CYCLE_25, intervals: [iv('2025-05-01', '2025-06-25')] }),
        '2025-07-14',
      )

      expect(result.horizon).toBe('2025-06-25')
      expect(result.state).toBe('current')
      expect(result.gap).toBeNull()
      expect(result.horizonReason).toBe('statement')
      expect(result.nextHorizonDate).toBe('2025-07-25')
    })

    it('is current when covered past a horizon that sits behind today', () => {
      const result = assembleAccount(
        input({ config: CYCLE_25, intervals: [iv('2025-05-01', '2025-07-10')] }),
        '2025-07-14',
      )

      expect(result.state).toBe('current')
    })

    it('is behind on a cycle account only up to the horizon, not to today', () => {
      const result = assembleAccount(
        input({ config: CYCLE_25, intervals: [iv('2025-04-01', '2025-05-25')] }),
        '2025-07-14',
      )

      expect(result.gap).toEqual({ from: '2025-05-26', through: '2025-06-25', days: 31 })
    })

    it('reports horizonReason today for a range account', () => {
      const result = assembleAccount(input({ intervals: [iv('2025-06-01', '2025-06-30')] }), '2025-07-14')

      expect(result.horizonReason).toBe('today')
      expect(result.nextHorizonDate).toBeNull()
    })

    it('counts a one-day gap as one day', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-06-01', '2025-07-13')] }),
        '2025-07-14',
      )

      expect(result.gap).toEqual({ from: '2025-07-14', through: '2025-07-14', days: 1 })
    })
  })

  describe('the leading edge', () => {
    // Out-of-order imports are normal — August gets done before July does. The gap runs from
    // the newest coverage forward; the July hole stays in the data but is never surfaced.
    it('measures from the newest span and hides the older hole', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-05-01', '2025-06-30'), iv('2025-08-01', '2025-08-31')] }),
        '2025-09-10',
      )

      expect(result.coveredThrough).toBe('2025-08-31')
      expect(result.gap).toEqual({ from: '2025-09-01', through: '2025-09-10', days: 10 })
      expect(JSON.stringify(result)).not.toContain('2025-07')
    })

    it('treats consecutive monthly statements as one unbroken edge', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-06-01', '2025-06-30'), iv('2025-07-01', '2025-07-31')] }),
        '2025-08-05',
      )

      expect(result.coveredThrough).toBe('2025-07-31')
      expect(result.gap!.days).toBe(5)
    })
  })

  describe('txnDatesInGap', () => {
    // The mixed-state case this feature exists for: splits entered from the phone sitting
    // inside a month that is otherwise unimported.
    it('picks up exactly the transactions inside the open window', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-06-01', '2025-06-30')],
          txnCountsByDate: {
            '2025-06-15': 3,  // inside coverage, not the gap
            '2025-07-04': 1,
            '2025-07-09': 2,
            '2025-07-20': 1,  // after the horizon
          },
        }),
        '2025-07-14',
      )

      expect(result.txnDatesInGap).toEqual(['2025-07-04', '2025-07-09'])
    })

    it('is empty when there is no gap', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-06-01', '2025-07-14')], txnCountsByDate: { '2025-07-02': 1 } }),
        '2025-07-14',
      )

      expect(result.txnDatesInGap).toEqual([])
    })

    it('returns the dates in order', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-06-01', '2025-06-30')],
          txnCountsByDate: { '2025-07-11': 1, '2025-07-02': 1, '2025-07-07': 1 },
        }),
        '2025-07-14',
      )

      expect(result.txnDatesInGap).toEqual(['2025-07-02', '2025-07-07', '2025-07-11'])
    })
  })

  describe('expectedTxns', () => {
    it('scales the covered rate across the gap', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-05-01', '2025-06-30')],
          txnCountsByDate: dailyTxns('2025-05-01', 61, 2),
        }),
        '2025-07-11',
      )

      // 122 transactions over 61 covered days = 2/day, across an 11-day gap.
      expect(result.gap!.days).toBe(11)
      expect(result.expectedTxns).toBe(22)
    })

    it('declines to estimate on too little covered history', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-07-01', '2025-07-05')],
          txnCountsByDate: { '2025-07-02': 4 },
        }),
        '2025-07-14',
      )

      expect(result.expectedTxns).toBeNull()
    })

    it('is null when there is no gap to estimate for', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-05-01', '2025-07-14')],
          txnCountsByDate: dailyTxns('2025-05-01', 60),
        }),
        '2025-07-14',
      )

      expect(result.expectedTxns).toBeNull()
    })

    // Uncovered days have no transactions precisely because they have not been imported.
    // Counting them in the denominator would read every neglected account as quiet.
    it('divides by covered days only, not by elapsed days', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-01-01', '2025-02-19')],
          txnCountsByDate: dailyTxns('2025-01-01', 50, 2),
        }),
        '2025-07-10',
      )

      // 2/day over the covered stretch, not 100 spread across six months.
      expect(result.expectedTxns).toBe(2 * result.gap!.days)
    })

    it('is zero for a confirmed-empty account with a gap', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-01-01', '2025-06-30')] }),
        '2025-07-14',
      )

      expect(result.expectedTxns).toBe(0)
    })
  })

  describe('dormant', () => {
    it('is true for a long confirmed-empty stretch', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-01-01', '2025-06-30')] }),
        '2025-07-14',
      )

      expect(result.dormant).toBe(true)
    })

    it('is false when the covered history has transactions in it', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-01-01', '2025-06-30')],
          txnCountsByDate: { '2025-03-15': 1 },
        }),
        '2025-07-14',
      )

      expect(result.dormant).toBe(false)
    })

    // Revival: a split entered from the phone on holiday pulls the account back up the queue
    // even though its covered history is empty.
    it('is false when a transaction lands inside the open gap', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2025-01-01', '2025-06-30')],
          txnCountsByDate: { '2025-07-08': 2 },
        }),
        '2025-07-14',
      )

      expect(result.dormant).toBe(false)
      expect(result.txnDatesInGap).toEqual(['2025-07-08'])
    })

    it('is false without enough confirmed-empty history to judge on', () => {
      const result = assembleAccount(
        input({ intervals: [iv('2025-07-01', '2025-07-10')] }),
        '2025-07-14',
      )

      expect(result.dormant).toBe(false)
    })

    it('is false for an account with no coverage at all', () => {
      expect(assembleAccount(input(), '2025-07-14').dormant).toBe(false)
    })

    // Only the trailing window counts, so an account that went quiet years ago but is busy
    // now is not sorted to the bottom.
    it('ignores emptiness older than the rate window', () => {
      const result = assembleAccount(
        input({
          intervals: [iv('2020-01-01', '2020-12-31'), iv('2025-05-01', '2025-06-30')],
          txnCountsByDate: dailyTxns('2025-05-01', 61),
        }),
        '2025-07-14',
      )

      expect(result.dormant).toBe(false)
    })
  })
})

describe('sortAccounts', () => {
  // Assembled once for a realistic base shape, then overridden per case — the sort only reads
  // state, dormant, gap.days and path.
  const acct = (over: Partial<ReturnType<typeof assembleAccount>>) => ({
    ...assembleAccount(input({ path: 'assets:x' }), '2025-07-14'),
    ...over,
  })

  it('puts the smallest gap first', () => {
    const sorted = sortAccounts([
      acct({ accountId: 'big', state: 'behind', gap: { from: 'a', through: 'b', days: 90 } }),
      acct({ accountId: 'small', state: 'behind', gap: { from: 'a', through: 'b', days: 3 } }),
      acct({ accountId: 'mid', state: 'behind', gap: { from: 'a', through: 'b', days: 30 } }),
    ])

    expect(sorted.map((a) => a.accountId)).toEqual(['small', 'mid', 'big'])
  })

  it('puts dormant accounts last regardless of gap size', () => {
    const sorted = sortAccounts([
      acct({ accountId: 'dormant', state: 'behind', dormant: true, gap: { from: 'a', through: 'b', days: 1 } }),
      acct({ accountId: 'live', state: 'behind', gap: { from: 'a', through: 'b', days: 60 } }),
    ])

    expect(sorted.map((a) => a.accountId)).toEqual(['live', 'dormant'])
  })

  it('ranks behind before unset before current', () => {
    const sorted = sortAccounts([
      acct({ accountId: 'current', state: 'current' }),
      acct({ accountId: 'unset', state: 'unset' }),
      acct({ accountId: 'behind', state: 'behind', gap: { from: 'a', through: 'b', days: 5 } }),
    ])

    expect(sorted.map((a) => a.accountId)).toEqual(['behind', 'unset', 'current'])
  })

  it('falls back to path order for otherwise equal accounts', () => {
    const sorted = sortAccounts([
      acct({ accountId: 'z', state: 'current', path: 'assets:zzz' }),
      acct({ accountId: 'a', state: 'current', path: 'assets:aaa' }),
    ])

    expect(sorted.map((a) => a.accountId)).toEqual(['a', 'z'])
  })

  it('does not mutate its input', () => {
    const accounts = [
      acct({ accountId: 'b', state: 'behind', gap: { from: 'a', through: 'b', days: 9 } }),
      acct({ accountId: 'a', state: 'behind', gap: { from: 'a', through: 'b', days: 1 } }),
    ]
    sortAccounts(accounts)

    expect(accounts.map((a) => a.accountId)).toEqual(['b', 'a'])
  })
})

describe('summarize', () => {
  const acct = (over: Partial<ReturnType<typeof assembleAccount>>) => ({
    ...assembleAccount(input(), '2025-07-14'),
    ...over,
  })

  it('counts by state and reports progress', () => {
    const summary = summarize([
      acct({ state: 'current' }),
      acct({ state: 'current' }),
      acct({ state: 'behind' }),
      acct({ state: 'unset' }),
    ])

    expect(summary).toEqual({
      current: 2,
      behind: 1,
      unset: 1,
      tracked: 4,
      dormant: 0,
      accountsToCatchUp: 1,
      progress: { current: 2, tracked: 4 },
    })
  })

  it('is all zeroes for no tracked accounts', () => {
    expect(summarize([])).toMatchObject({ tracked: 0, accountsToCatchUp: 0, progress: { current: 0, tracked: 0 } })
  })

  // The dashboard counts accounts, never days — an account count is actionable where a
  // day count is only guilt.
  it('counts dormant accounts separately from the work total', () => {
    const summary = summarize([
      acct({ state: 'behind', dormant: true }),
      acct({ state: 'behind' }),
    ])

    expect(summary.dormant).toBe(1)
    expect(summary.accountsToCatchUp).toBe(2)
  })
})
