import { describe, it, expect } from 'bun:test'
import type { PostingRole, Transaction } from './api'
import {
  cashHistoryRows,
  counterpartiesOf,
  dayHeading,
  groupByDay,
  leafOf,
  shareOf,
  walletDeltaCents,
} from './cash-history'

const WALLET = 'wallet-cad'

let seq = 0
function posting(
  accountId: string,
  accountPath: string,
  amount: string,
  role: PostingRole = 'subject',
) {
  return { id: `p${++seq}`, accountId, accountPath, amount, currency: 'CAD', role }
}

/** A plain cash purchase: wallet out, one expense in. */
function purchase(id: string, date: string, amount: string, category = 'expenses:food'): Transaction {
  return {
    id,
    date,
    description: 'Lunch',
    postings: [
      posting(WALLET, 'assets:cash:cad', `-${amount}`, 'transfer'),
      posting('cat', category, amount),
    ],
  }
}

describe('leafOf', () => {
  it('takes the last path segment — what a person calls the account', () => {
    expect(leafOf('expenses:groceries:veg')).toBe('veg')
    expect(leafOf('assets:cash:cad')).toBe('cad')
  })

  it('falls back to the whole string for a rootless path', () => {
    expect(leafOf('wallet')).toBe('wallet')
    expect(leafOf('')).toBe('')
  })
})

describe('walletDeltaCents', () => {
  it('reports the wallet movement', () => {
    expect(walletDeltaCents(purchase('t1', '2026-08-27', '12.50'), WALLET)).toBe(-1250)
  })

  it('sums every leg touching the wallet', () => {
    // Legal, if unusual — a transaction may touch one account more than once.
    const tx: Transaction = {
      id: 't',
      date: '2026-08-27',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-10.00', 'transfer'),
        posting(WALLET, 'assets:cash:cad', '-5.00', 'transfer'),
        posting('cat', 'expenses:food', '15.00'),
      ],
    }
    expect(walletDeltaCents(tx, WALLET)).toBe(-1500)
  })

  it('is zero for a transaction that misses the wallet', () => {
    expect(walletDeltaCents(purchase('t', '2026-08-27', '5.00'), 'other')).toBe(0)
  })
})

describe('counterpartiesOf', () => {
  it('names the expense categories of a split', () => {
    const tx: Transaction = {
      id: 't',
      date: '2026-08-27',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-180.00', 'transfer'),
        posting('a', 'expenses:food', '90.00'),
        posting('b', 'expenses:household', '60.00'),
        posting('c', 'expenses:electronics', '30.00'),
      ],
    }
    expect(counterpartiesOf(tx, WALLET)).toEqual(['food', 'household', 'electronics'])
  })

  it('drops the conversion plumbing from a cross-currency top-up', () => {
    // Conversion legs exist to make two currencies balance; they say nothing
    // about what happened, so naming them would bury the account that matters.
    const tx: Transaction = {
      id: 't',
      date: '2026-08-27',
      postings: [
        posting('chq', 'assets:chequing', '-200.00', 'transfer'),
        posting('conv', 'equity:conversion', '200.00', 'conversion'),
        posting('conv', 'equity:conversion', '-1000.00', 'conversion'),
        posting(WALLET, 'assets:cash:cad', '1000.00', 'transfer'),
      ],
    }
    expect(counterpartiesOf(tx, WALLET)).toEqual(['chequing'])
  })

  it('drops the Fish Pie receivable, which the group name says better', () => {
    const tx: Transaction = {
      id: 't',
      date: '2026-08-27',
      groupName: 'Household',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-180.00', 'transfer'),
        posting('recv', 'assets:receivable:household', '90.00', 'share'),
        posting('food', 'expenses:food', '90.00'),
      ],
    }
    expect(counterpartiesOf(tx, WALLET)).toEqual(['food'])
  })

  it('de-duplicates repeated leaves', () => {
    const tx: Transaction = {
      id: 't',
      date: '2026-08-27',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-20.00', 'transfer'),
        posting('a', 'expenses:food', '10.00'),
        posting('b', 'expenses:travel:food', '10.00'),
      ],
    }
    expect(counterpartiesOf(tx, WALLET)).toEqual(['food'])
  })
})

describe('shareOf', () => {
  it('reports the expense leg of a group transaction — what you consumed', () => {
    // You fronted 180 but only ate 90 of it; the feed should say so.
    const tx: Transaction = {
      id: 't',
      date: '2026-08-27',
      groupName: 'Household',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-180.00', 'transfer'),
        posting('recv', 'assets:receivable:household', '90.00', 'share'),
        posting('food', 'expenses:food', '90.00'),
      ],
    }
    expect(shareOf(tx)).toBe('90.00')
  })

  it('is null for an ordinary cash purchase', () => {
    expect(shareOf(purchase('t', '2026-08-27', '10.00'))).toBeNull()
  })
})

describe('cashHistoryRows', () => {
  const transactions = [
    purchase('t3', '2026-08-27T10:00:00Z', '20.00'),
    purchase('t2', '2026-08-26T10:00:00Z', '30.00'),
    purchase('t1', '2026-08-25T10:00:00Z', '50.00'),
  ]

  it('unwinds the running balance from the live one', () => {
    // Deriving from the current balance rather than accumulating from zero keeps
    // the figures agreeing with the Wallets tab even on a partial feed.
    const rows = cashHistoryRows({
      transactions,
      walletId: WALLET,
      currency: 'CAD',
      currentBalance: '100.00',
    })
    expect(rows.map((r) => r.balanceAfter)).toEqual(['100.00', '120.00', '150.00'])
  })

  it('reports each wallet movement signed', () => {
    const rows = cashHistoryRows({
      transactions,
      walletId: WALLET,
      currency: 'CAD',
      currentBalance: '100.00',
    })
    expect(rows.map((r) => r.amount)).toEqual(['-20.00', '-30.00', '-50.00'])
  })

  it('shows a split as one row naming its categories', () => {
    // It was one payment; three rows would misrepresent it as three.
    const split: Transaction = {
      id: 't',
      date: '2026-08-27T10:00:00Z',
      description: 'Costco run',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-180.00', 'transfer'),
        posting('a', 'expenses:food', '90.00'),
        posting('b', 'expenses:household', '60.00'),
        posting('c', 'expenses:electronics', '30.00'),
      ],
    }
    const rows = cashHistoryRows({
      transactions: [split],
      walletId: WALLET,
      currency: 'CAD',
      currentBalance: '0.00',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].counterparties).toEqual(['food', 'household', 'electronics'])
    expect(rows[0].amount).toBe('-180.00')
  })

  it('frames a cash-funded group expense with its group and share', () => {
    const groupTx: Transaction = {
      id: 't',
      date: '2026-08-27T10:00:00Z',
      description: 'Dinner',
      groupName: 'Household',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-180.00', 'transfer'),
        posting('recv', 'assets:receivable:household', '90.00', 'share'),
        posting('food', 'expenses:food', '90.00'),
      ],
    }
    const rows = cashHistoryRows({
      transactions: [groupTx],
      walletId: WALLET,
      currency: 'CAD',
      currentBalance: '0.00',
    })
    expect(rows[0].groupName).toBe('Household')
    expect(rows[0].share).toBe('90.00')
    // The wallet really is down the full amount — the notes left your hand.
    expect(rows[0].amount).toBe('-180.00')
  })

  it('shows a top-up as a gain', () => {
    const topUp: Transaction = {
      id: 't',
      date: '2026-08-27T10:00:00Z',
      description: 'Cash withdrawal',
      postings: [
        posting('chq', 'assets:chequing', '-200.00', 'transfer'),
        posting(WALLET, 'assets:cash:cad', '200.00', 'transfer'),
      ],
    }
    const rows = cashHistoryRows({
      transactions: [topUp],
      walletId: WALLET,
      currency: 'CAD',
      currentBalance: '200.00',
    })
    expect(rows[0].amount).toBe('200.00')
    expect(rows[0].counterparties).toEqual(['chequing'])
  })

  it('skips transactions that never touch the wallet', () => {
    const other = purchase('other', '2026-08-27T10:00:00Z', '5.00')
    const rows = cashHistoryRows({
      transactions: [other],
      walletId: 'a-different-wallet',
      currency: 'CAD',
      currentBalance: '0.00',
    })
    expect(rows).toEqual([])
  })

  it('falls back to a sensible description', () => {
    const bare: Transaction = {
      id: 't',
      date: '2026-08-27T10:00:00Z',
      description: '   ',
      postings: [
        posting(WALLET, 'assets:cash:cad', '-5.00', 'transfer'),
        posting('a', 'expenses:food', '5.00'),
      ],
    }
    expect(
      cashHistoryRows({ transactions: [bare], walletId: WALLET, currency: 'CAD', currentBalance: '0.00' })[0]
        .description,
    ).toBe('Cash')
  })

  it('handles an empty feed', () => {
    expect(
      cashHistoryRows({ transactions: [], walletId: WALLET, currency: 'CAD', currentBalance: '0.00' }),
    ).toEqual([])
  })
})

describe('groupByDay', () => {
  it('groups consecutive rows of the same day', () => {
    const rows = cashHistoryRows({
      transactions: [
        purchase('a', '2026-08-27T18:00:00Z', '5.00'),
        purchase('b', '2026-08-27T09:00:00Z', '6.00'),
        purchase('c', '2026-08-26T09:00:00Z', '7.00'),
      ],
      walletId: WALLET,
      currency: 'CAD',
      currentBalance: '0.00',
    })
    const days = groupByDay(rows)
    expect(days.map((d) => d.date)).toEqual(['2026-08-27', '2026-08-26'])
    expect(days[0].rows).toHaveLength(2)
    expect(days[1].rows).toHaveLength(1)
  })

  it('handles an empty list', () => {
    expect(groupByDay([])).toEqual([])
  })
})

describe('dayHeading', () => {
  const now = new Date('2026-08-27T12:00:00Z')

  it('names today and yesterday', () => {
    expect(dayHeading('2026-08-27', now)).toBe('Today')
    expect(dayHeading('2026-08-26', now)).toBe('Yesterday')
  })

  it('spells out an older day', () => {
    expect(dayHeading('2026-08-20', now)).toBe('Thu 20 Aug')
  })

  it('crosses a month boundary for yesterday', () => {
    expect(dayHeading('2026-07-31', new Date('2026-08-01T12:00:00Z'))).toBe('Yesterday')
  })

  it('passes through an unparseable date rather than throwing', () => {
    expect(dayHeading('not-a-date', now)).toBe('not-a-date')
  })
})
