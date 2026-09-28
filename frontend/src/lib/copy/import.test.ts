/**
 * The import messages that decide something.
 *
 * Most of `import.ts` is a string or a one-line `plural`, and reading it is the review. These
 * few compose a message from the outcomes they are handed — a clause that appears only when
 * its count is non-zero — so they have branches, and a branch that drops or doubles a clause
 * is a toast that misreports what an import did.
 */
import { describe, expect, it } from 'bun:test'
import { importCopy } from './import'

describe('commit.imported', () => {
  const imported = importCopy.commit.imported

  it('says the count alone when nothing else happened', () => {
    expect(imported({ created: 12, fishPie: 0, skipped: 0 })).toBe('12 transactions imported')
    expect(imported({ created: 1, fishPie: 0, skipped: 0 })).toBe('1 transaction imported')
  })

  it('adds a clause for each other outcome, in a fixed order', () => {
    expect(imported({ created: 12, fishPie: 3, skipped: 0 })).toBe(
      '12 transactions imported, 3 added to Fish Pie',
    )
    expect(imported({ created: 12, fishPie: 0, skipped: 2 })).toBe(
      '12 transactions imported, 2 already imported',
    )
    expect(imported({ created: 12, fishPie: 3, skipped: 2 })).toBe(
      '12 transactions imported, 3 added to Fish Pie, 2 already imported',
    )
  })

  it('still says nothing was created when every row was already in', () => {
    // A zero count is the one the reader most needs, so it is never the clause left out.
    expect(imported({ created: 0, fishPie: 0, skipped: 5 })).toBe(
      '0 transactions imported, 5 already imported',
    )
  })
})

describe('sort.apply and sort.applied', () => {
  it('leaves the rules out when none are remembered', () => {
    expect(importCopy.sort.apply(4, 0)).toBe('Apply to 4 rows')
    expect(importCopy.sort.applied(4, 0)).toBe('4 rows assigned')
  })

  it('names the rules when some are', () => {
    expect(importCopy.sort.apply(1, 1)).toBe('Apply to 1 row · 1 rule')
    expect(importCopy.sort.apply(4, 2)).toBe('Apply to 4 rows · 2 rules')
    expect(importCopy.sort.applied(1, 1)).toBe('1 row assigned, 1 rule saved')
    expect(importCopy.sort.applied(4, 2)).toBe('4 rows assigned, 2 rules saved')
  })
})

describe('commit.ruleSaved', () => {
  it('says only that the rule was saved when it matched nothing else', () => {
    expect(importCopy.commit.ruleSaved('LOBLAWS', 0)).toBe('Rule saved for “LOBLAWS”')
  })

  it('says how many other rows it filled in', () => {
    expect(importCopy.commit.ruleSaved('LOBLAWS', 1)).toBe(
      'Rule saved for “LOBLAWS” — applied to 1 more row',
    )
    expect(importCopy.commit.ruleSaved('LOBLAWS', 3)).toBe(
      'Rule saved for “LOBLAWS” — applied to 3 more rows',
    )
  })
})

describe('the counts that used to read wrongly at one', () => {
  // Each of these rendered "1 rows", "1 matches" or "1 still need" before the story that
  // moved it here.
  it('agrees with a count of one', () => {
    expect(importCopy.unparsed(1)).toBe('1 row could not be parsed and will be skipped.')
    expect(importCopy.review.unfinished(1)).toBe('1 still needs an account')
    expect(importCopy.rules.matches(1)).toBe('1 match')
    expect(importCopy.resume.meta(1, 'just now')).toBe('1 row · saved just now')
  })

  it('and with any other count', () => {
    expect(importCopy.unparsed(3)).toBe('3 rows could not be parsed and will be skipped.')
    expect(importCopy.review.unfinished(3)).toBe('3 still need an account')
    expect(importCopy.rules.matches(0)).toBe('0 matches')
    expect(importCopy.resume.meta(40, '2 hours ago')).toBe('40 rows · saved 2 hours ago')
  })
})
