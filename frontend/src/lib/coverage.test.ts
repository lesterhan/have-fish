import { describe, it, expect } from 'bun:test'
import {
  completeness,
  completenessNote,
  coverageFor,
  formatCompletenessDate,
  statusNote,
  type AccountCoverageStatus,
} from './coverage'

function row(over: Partial<AccountCoverageStatus> & { accountId: string }): AccountCoverageStatus {
  return { state: 'current', coveredThrough: '2026-09-04', dormant: false, ...over }
}

const behind = (id: string, through: string) =>
  row({ accountId: id, state: 'behind', coveredThrough: through })
const current = (id: string) => row({ accountId: id, state: 'current' })
const unset = (id: string) => row({ accountId: id, state: 'unset', coveredThrough: null })

describe('completeness', () => {
  it('reports no date when every contributor is current', () => {
    expect(completeness([current('a'), current('b')])).toEqual({
      through: null,
      unknown: 0,
      contributors: 2,
    })
  })

  it('takes the oldest leading edge among behind contributors', () => {
    const result = completeness([current('a'), behind('b', '2026-08-15'), behind('c', '2026-06-21')])

    expect(result.through).toBe('2026-06-21')
    expect(result.unknown).toBe(0)
    expect(result.contributors).toBe(3)
  })

  it('does not let a dormant account set the date', () => {
    const dormant = row({
      accountId: 'old',
      state: 'behind',
      coveredThrough: '2025-01-31',
      dormant: true,
    })

    const result = completeness([behind('b', '2026-08-15'), dormant])

    expect(result.through).toBe('2026-08-15')
    expect(result.contributors).toBe(1)
  })

  it('reports caught up when the only behind account is dormant', () => {
    const dormant = row({
      accountId: 'old',
      state: 'behind',
      coveredThrough: '2025-01-31',
      dormant: true,
    })

    expect(completeness([current('a'), dormant])).toEqual({
      through: null,
      unknown: 0,
      contributors: 1,
    })
  })

  // The distinction the whole helper turns on: an account nobody has asserted coverage for is
  // not evidence of being up to date, so it must not come back looking like the caught-up case.
  it('counts an unset account as unknown rather than as current', () => {
    const result = completeness([current('a'), unset('b')])

    expect(result).toEqual({ through: null, unknown: 1, contributors: 2 })
  })

  it('reports unknowns alongside a date rather than instead of it', () => {
    const result = completeness([behind('a', '2026-06-21'), unset('b')])

    expect(result).toEqual({ through: '2026-06-21', unknown: 1, contributors: 2 })
  })

  // Shouldn't be reachable — the backend only reaches 'behind' by reading a leading edge off
  // the coverage — but a malformed row must degrade to "not known", never to a false date.
  it('treats a behind account with no leading edge as unknown', () => {
    const result = completeness([row({ accountId: 'a', state: 'behind', coveredThrough: null })])

    expect(result).toEqual({ through: null, unknown: 1, contributors: 1 })
  })

  it('reports no contributors for an empty set', () => {
    expect(completeness([])).toEqual({ through: null, unknown: 0, contributors: 0 })
  })

  it('reports no contributors when every account is dormant', () => {
    const dormant = row({ accountId: 'old', state: 'behind', coveredThrough: '2025-01-31', dormant: true })

    expect(completeness([dormant])).toEqual({ through: null, unknown: 0, contributors: 0 })
  })
})

describe('coverageFor', () => {
  const byId = new Map<string, AccountCoverageStatus>([
    ['a', behind('a', '2026-06-21')],
    ['b', current('b')],
  ])

  it('narrows to the accounts a rollup sums', () => {
    expect(coverageFor(byId, ['a']).map((r) => r.accountId)).toEqual(['a'])
  })

  // An id with no coverage row is not a contributor — an equity account, a Fish Pie clearing
  // account, or one the user has hidden. Silently dropping it is the intended reading.
  it('drops ids the coverage payload does not carry', () => {
    expect(coverageFor(byId, ['a', 'not-tracked']).map((r) => r.accountId)).toEqual(['a'])
  })

  it('feeds completeness so a tile dates itself from its own contributors', () => {
    expect(completeness(coverageFor(byId, ['b'])).through).toBeNull()
    expect(completeness(coverageFor(byId, ['a', 'b'])).through).toBe('2026-06-21')
  })
})

describe('formatCompletenessDate', () => {
  it('drops the year while it is obvious', () => {
    expect(formatCompletenessDate('2026-06-21', '2026-09-04')).toBe('Jun 21')
  })

  // A bare month and day from last year reads as recent, which is backwards for a date whose
  // whole job is to say how far behind something is.
  it('keeps the year once the date is from another one', () => {
    expect(formatCompletenessDate('2025-06-21', '2026-09-04')).toBe('Jun 21, 2025')
  })
})

describe('completenessNote', () => {
  const TODAY = '2026-09-04'
  const note = (rows: AccountCoverageStatus[]) => completenessNote(completeness(rows), TODAY)

  it('says nothing when there are no contributors', () => {
    expect(note([])).toBeNull()
  })

  it('reads as complete through today when nothing is outstanding', () => {
    const result = note([current('a')])

    expect(result?.text).toBe('complete through today')
    expect(result?.current).toBe(true)
  })

  it('names the date when something is behind', () => {
    const result = note([current('a'), behind('b', '2026-06-21')])

    expect(result?.text).toBe('complete through Jun 21')
    expect(result?.current).toBe(false)
  })

  // Both facts at one weight. Suppressing the date over a single unbootstrapped account
  // would throw away the most useful thing the app knows, and on a real ledger that account
  // is common — nine behind and one unset is what prod actually looks like.
  it('qualifies the date with the unknown rather than replacing it', () => {
    const result = note([behind('a', '2026-06-21'), unset('b')])

    expect(result?.text).toBe('complete through Jun 21, 1 account has no starting line')
    expect(result?.current).toBe(false)
    expect(result?.detail).toContain('Catch Up')
  })

  // "Complete through today, 1 account has no starting line" is two clauses contradicting
  // each other in one breath, so with no date to qualify the unknown is the whole message.
  it('drops the date clause when there is no date to give', () => {
    expect(note([current('a'), unset('b')])?.text).toBe('1 account has no starting line')
  })

  it('agrees its verb with the count', () => {
    expect(note([unset('a'), unset('b'), current('c')])?.text).toBe(
      '2 accounts have no starting line',
    )
  })

  it('carries a fuller sentence for the tooltip than for the line', () => {
    const result = note([behind('a', '2026-06-21')])

    expect(result?.detail.length).toBeGreaterThan(result!.text.length)
    expect(result?.detail).toContain('Jun 21')
  })
})

describe('statusNote', () => {
  const TODAY = '2026-09-04'
  const note = (rows: AccountCoverageStatus[]) => statusNote(completeness(rows), TODAY)

  // An empty strip says less than a sentence about nothing.
  it('says nothing when nothing is tracked', () => {
    expect(note([])).toBeNull()
  })

  // The line stands alone in the bar rather than under a figure, so it carries its own
  // subject — the tiles' bare "complete through Jun 21" would be a fragment here.
  it('names its subject, unlike the line under a tile', () => {
    expect(note([behind('a', '2026-06-21')])?.text).toBe('Ledger complete through Jun 21')
  })

  it('reads as current when nothing is outstanding', () => {
    const result = note([current('a'), current('b')])

    expect(result?.text).toBe('Ledger complete through today')
    expect(result?.current).toBe(true)
  })

  it('takes its date from the stalest live account', () => {
    expect(note([behind('a', '2026-08-15'), behind('b', '2026-04-23')])?.text).toBe(
      'Ledger complete through Apr 23',
    )
  })

  it('is not held back by a dormant account', () => {
    const dormant = row({
      accountId: 'old', state: 'behind', coveredThrough: '2025-01-31', dormant: true,
    })

    expect(note([current('a'), dormant])?.text).toBe('Ledger complete through today')
  })

  it('carries the unrecorded accounts alongside the date', () => {
    const result = note([behind('a', '2026-06-21'), unset('b')])

    expect(result?.text).toBe('Ledger complete through Jun 21 — 1 account has no starting line')
    expect(result?.current).toBe(false)
  })

  it('agrees its verb with the count', () => {
    expect(note([current('a'), unset('b'), unset('c')])?.text).toBe(
      'Ledger complete through today — 2 accounts have no starting line',
    )
  })

  // The same computation the accounts tiles run, so the two can never disagree about the
  // same accounts — only the wording differs.
  it('agrees with the tile line on which date is quoted', () => {
    const rows = [behind('a', '2026-06-21'), current('b')]

    expect(statusNote(completeness(rows), TODAY)?.text).toContain('Jun 21')
    expect(completenessNote(completeness(rows), TODAY)?.text).toContain('Jun 21')
  })
})
