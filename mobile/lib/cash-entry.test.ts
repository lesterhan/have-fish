import { describe, it, expect } from 'bun:test'
import {
  blockerMessage,
  buildCashPostings,
  canSubmitCash,
  fromCents,
  isFullyAllocated,
  mergeRowsByAccount,
  remainder,
  remainderCents,
  rowsTotalCents,
  seedAmountForNewRow,
  submitBlocker,
  syncSingleRow,
  toCents,
  type SplitRow,
} from './cash-entry'

function row(accountId: string | null, amount: string, id = accountId ?? 'row'): SplitRow {
  return { id, accountId, amount }
}

describe('toCents / fromCents', () => {
  it('round-trips ordinary amounts', () => {
    expect(toCents('180.00')).toBe(18000)
    expect(fromCents(18000)).toBe('180.00')
    expect(fromCents(toCents('0.05')!)).toBe('0.05')
  })

  it('rounds rather than truncates at the binary edge', () => {
    // Multiplying by 100 lands just under the integer for many ordinary amounts:
    // 8.87 * 100 is 886.9999…, 0.29 * 100 is 28.9999…. Truncating would bill a
    // cent less than the user typed, on amounts that look completely unremarkable.
    expect(toCents('8.87')).toBe(887)
    expect(toCents('0.29')).toBe(29)
    expect(toCents('1.15')).toBe(115)
  })

  it('handles a partly typed amount', () => {
    expect(toCents('12.')).toBe(1200)
    expect(toCents('0.')).toBe(0)
  })

  it('reports an unusable amount as null', () => {
    expect(toCents('')).toBeNull()
    expect(toCents('abc')).toBeNull()
  })

  it('formats negatives with the sign', () => {
    expect(fromCents(-4000)).toBe('-40.00')
  })
})

describe('rowsTotalCents', () => {
  it('sums the rows', () => {
    expect(rowsTotalCents([row('a', '90.00'), row('b', '60.00'), row('c', '30.00')])).toBe(18000)
  })

  it('sums amounts that float addition would drift on', () => {
    // 0.1 + 0.2 !== 0.3 in floats — a split that looks exact on screen must not
    // fail the backend's balance check by a rounding hair.
    expect(rowsTotalCents([row('a', '0.10'), row('b', '0.20')])).toBe(30)
    const thirds = [row('a', '33.33'), row('b', '33.33'), row('c', '33.34')]
    expect(rowsTotalCents(thirds)).toBe(10000)
  })

  it('counts an empty row as zero', () => {
    expect(rowsTotalCents([row('a', ''), row('b', '5.00')])).toBe(500)
  })
})

describe('remainder', () => {
  it('reports what is still unallocated', () => {
    const rows = [row('a', '90.00'), row('b', '60.00')]
    expect(remainderCents('180.00', rows)).toBe(3000)
    expect(remainder('180.00', rows)).toBe('30.00')
  })

  it('is zero when the rows add up', () => {
    const rows = [row('a', '90.00'), row('b', '90.00')]
    expect(isFullyAllocated('180.00', rows)).toBe(true)
    expect(remainder('180.00', rows)).toBe('0.00')
  })

  it('goes negative when the rows overshoot', () => {
    expect(remainder('100.00', [row('a', '120.00')])).toBe('-20.00')
    expect(isFullyAllocated('100.00', [row('a', '120.00')])).toBe(false)
  })
})

describe('seedAmountForNewRow', () => {
  it('seeds a new row with the unallocated amount', () => {
    // The common two-way split: the second row needs no typing at all.
    expect(seedAmountForNewRow('180.00', [row('a', '90.00')])).toBe('90.00')
  })

  it('seeds the whole total when nothing is allocated', () => {
    expect(seedAmountForNewRow('180.00', [])).toBe('180.00')
  })

  it('seeds zero rather than a negative when the rows overshoot', () => {
    expect(seedAmountForNewRow('100.00', [row('a', '120.00')])).toBe('0.00')
  })
})

describe('syncSingleRow', () => {
  it('keeps a lone row in step with the hero', () => {
    // The ordinary non-split purchase: no retyping the amount just entered.
    expect(syncSingleRow([row('a', '')], '42.50')).toEqual([
      { id: 'a', accountId: 'a', amount: '42.50' },
    ])
  })

  it('normalises a partly typed hero amount', () => {
    expect(syncSingleRow([row('a', '')], '12.')[0].amount).toBe('12.00')
  })

  it('clears the row when the hero is cleared', () => {
    expect(syncSingleRow([row('a', '10.00')], '')[0].amount).toBe('')
  })

  it('leaves explicit amounts alone once there are two rows', () => {
    const rows = [row('a', '90.00'), row('b', '60.00')]
    expect(syncSingleRow(rows, '180.00')).toBe(rows)
  })

  it('returns the same array when nothing changes, so React can skip a render', () => {
    const rows = [row('a', '42.50')]
    expect(syncSingleRow(rows, '42.50')).toBe(rows)
  })
})

describe('submitBlocker', () => {
  const wallet = 'w1'

  it('passes a complete single-row entry', () => {
    expect(
      submitBlocker({ walletId: wallet, total: '42.50', rows: [row('a', '42.50')] }),
    ).toBeNull()
  })

  it('passes a balanced three-way split', () => {
    const rows = [row('a', '90.00'), row('b', '60.00'), row('c', '30.00')]
    expect(submitBlocker({ walletId: wallet, total: '180.00', rows })).toBeNull()
    expect(canSubmitCash({ walletId: wallet, total: '180.00', rows })).toBe(true)
  })

  it('names the next thing to do, in the order the screen is filled in', () => {
    // Each check should surface before the ones after it, so the hint never
    // points at a later step while an earlier one is still undone.
    expect(submitBlocker({ walletId: null, total: '', rows: [] })).toBe('no-wallet')
    expect(submitBlocker({ walletId: wallet, total: '', rows: [] })).toBe('no-amount')
    expect(submitBlocker({ walletId: wallet, total: '10.00', rows: [] })).toBe('no-account')
    expect(
      submitBlocker({ walletId: wallet, total: '10.00', rows: [row(null, '10.00')] }),
    ).toBe('no-account')
  })

  it('rejects a zero or negative total', () => {
    expect(submitBlocker({ walletId: wallet, total: '0.00', rows: [row('a', '0.00')] })).toBe(
      'no-amount',
    )
  })

  it('blocks while money is unassigned', () => {
    expect(
      submitBlocker({ walletId: wallet, total: '180.00', rows: [row('a', '90.00')] }),
    ).toBe('unallocated')
  })

  it('blocks when the rows overshoot the total', () => {
    expect(
      submitBlocker({ walletId: wallet, total: '100.00', rows: [row('a', '120.00')] }),
    ).toBe('over-allocated')
  })

  it('blocks on a one-cent discrepancy', () => {
    // The whole point of cents arithmetic: a split that is a hair out must not
    // slip through to a backend rejection.
    const rows = [row('a', '33.33'), row('b', '33.33'), row('c', '33.33')]
    expect(submitBlocker({ walletId: wallet, total: '100.00', rows })).toBe('unallocated')
    expect(remainder('100.00', rows)).toBe('0.01')
  })
})

describe('blockerMessage', () => {
  it('quotes the remainder when money is unassigned', () => {
    expect(blockerMessage('unallocated', '30.00')).toBe('30.00 left to assign')
  })

  it('drops the sign when reporting an overshoot', () => {
    expect(blockerMessage('over-allocated', '-20.00')).toBe('20.00 over the total')
  })

  it('has copy for every blocker', () => {
    for (const blocker of ['no-wallet', 'no-amount', 'no-account', 'unallocated', 'over-allocated'] as const) {
      expect(blockerMessage(blocker, '1.00').length).toBeGreaterThan(0)
    }
  })
})

describe('buildCashPostings', () => {
  const base = { walletAccountId: 'wallet', currency: 'CAD' }

  it('builds a two-posting purchase', () => {
    expect(buildCashPostings({ ...base, total: '42.50', rows: [row('food', '42.50')] })).toEqual([
      { accountId: 'wallet', amount: '-42.50', currency: 'CAD' },
      { accountId: 'food', amount: '42.50', currency: 'CAD' },
    ])
  })

  it('builds the split purchase from the epic', () => {
    // 180 across food / household / electronics — one payment, three categories.
    const rows = [row('food', '90.00'), row('household', '60.00'), row('electronics', '30.00')]
    const postings = buildCashPostings({ ...base, total: '180.00', rows })

    expect(postings).toEqual([
      { accountId: 'wallet', amount: '-180.00', currency: 'CAD' },
      { accountId: 'food', amount: '90.00', currency: 'CAD' },
      { accountId: 'household', amount: '60.00', currency: 'CAD' },
      { accountId: 'electronics', amount: '30.00', currency: 'CAD' },
    ])
  })

  it('credits the wallet and debits the expenses', () => {
    const postings = buildCashPostings({ ...base, total: '10.00', rows: [row('food', '10.00')] })
    expect(parseFloat(postings[0].amount)).toBeLessThan(0)
    expect(postings.slice(1).every((p) => parseFloat(p.amount) > 0)).toBe(true)
  })

  it('produces postings that sum to zero', () => {
    // The backend rejects anything else; this is the invariant it checks.
    const rows = [row('a', '33.33'), row('b', '33.33'), row('c', '33.34')]
    const postings = buildCashPostings({ ...base, total: '100.00', rows })
    const sum = postings.reduce((acc, p) => acc + (toCents(p.amount) ?? 0), 0)
    expect(sum).toBe(0)
  })

  it('carries the wallet currency on every leg', () => {
    const postings = buildCashPostings({
      ...base,
      currency: 'CNY',
      total: '30.00',
      rows: [row('a', '20.00'), row('b', '10.00')],
    })
    expect(postings.every((p) => p.currency === 'CNY')).toBe(true)
  })

  it('refuses splits that do not add up', () => {
    expect(() =>
      buildCashPostings({ ...base, total: '180.00', rows: [row('a', '90.00')] }),
    ).toThrow(/add up to 180.00/)
  })

  it('refuses a row with no category', () => {
    expect(() =>
      buildCashPostings({ ...base, total: '10.00', rows: [row(null, '10.00')] }),
    ).toThrow(/needs a category/)
  })

  it('refuses a row with no amount', () => {
    expect(() =>
      buildCashPostings({ ...base, total: '10.00', rows: [row('a', '')] }),
    ).toThrow(/needs an amount/)
  })

  it('refuses a zero total', () => {
    expect(() => buildCashPostings({ ...base, total: '0.00', rows: [row('a', '0.00')] })).toThrow(
      /greater than zero/,
    )
  })

  it('refuses an empty row list', () => {
    expect(() => buildCashPostings({ ...base, total: '10.00', rows: [] })).toThrow(/at least one/)
  })
})

describe('mergeRowsByAccount', () => {
  it('collapses repeated accounts, summing them', () => {
    const merged = mergeRowsByAccount([
      row('food', '10.00', 'r1'),
      row('household', '5.00', 'r2'),
      row('food', '2.50', 'r3'),
    ])
    expect(merged.map((r) => [r.accountId, r.amount])).toEqual([
      ['food', '12.50'],
      ['household', '5.00'],
    ])
  })

  it('leaves distinct accounts alone', () => {
    const rows = [row('a', '1.00'), row('b', '2.00')]
    expect(mergeRowsByAccount(rows).map((r) => r.amount)).toEqual(['1.00', '2.00'])
  })

  it('keeps unfilled rows separate', () => {
    // Two rows still awaiting a category are two intentions, not one.
    const merged = mergeRowsByAccount([row(null, '1.00', 'r1'), row(null, '2.00', 'r2')])
    expect(merged).toHaveLength(2)
  })

  it('preserves the total it was given', () => {
    const rows = [row('a', '10.00', 'r1'), row('a', '20.00', 'r2'), row('b', '5.00', 'r3')]
    expect(rowsTotalCents(mergeRowsByAccount(rows))).toBe(rowsTotalCents(rows))
  })
})
