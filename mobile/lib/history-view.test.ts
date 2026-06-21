/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import type { GroupExpense, GroupSettlement } from './api'
import { historyView } from './history-view'

function expense(over: Partial<GroupExpense> = {}): GroupExpense {
  return {
    id: 'e1',
    groupId: 'g1',
    paidByUserId: 'u1',
    payerName: 'Ada',
    description: 'Groceries',
    amount: '42.50',
    currency: 'CAD',
    date: '2026-06-18',
    transactionId: null,
    categoryId: 'c1',
    categoryName: 'Food',
    createdAt: '2026-06-18T00:00:00Z',
    deletedAt: null,
    splits: [],
    ...over,
  }
}

function settlement(over: Partial<GroupSettlement> = {}): GroupSettlement {
  return {
    id: 's1',
    groupId: 'g1',
    fromUserId: 'u1',
    fromUserName: 'Ada',
    toUserId: 'u2',
    toUserName: 'Bo',
    amount: '20.00',
    currency: 'CAD',
    date: '2026-06-17',
    note: null,
    status: 'completed',
    payerAccountId: null,
    payerTransactionId: null,
    receiverTransactionId: null,
    batchId: null,
    settledAmount: null,
    settledCurrency: null,
    fxRate: null,
    createdAt: '2026-06-17T00:00:00Z',
    deletedAt: null,
    ...over,
  }
}

describe('historyView — expenses', () => {
  it('maps an expense to a row with avatar name, meta and amount', () => {
    const { expenses } = historyView([expense()], [])
    expect(expenses[0]).toEqual({
      id: 'e1',
      payer: 'Ada',
      description: 'Groceries',
      date: 'Jun 18',
      amount: '42.50',
      currency: 'CAD',
      category: 'FOOD',
    })
  })

  it('formats the amount with grouping and 2 decimals', () => {
    const { expenses } = historyView([expense({ amount: '1234.5' })], [])
    expect(expenses[0].amount).toBe('1,234.50')
  })

  it('uppercases the category tag', () => {
    const { expenses } = historyView([expense({ categoryName: 'dining out' })], [])
    expect(expenses[0].category).toBe('DINING OUT')
  })

  it('omits the category tag when uncategorized', () => {
    const { expenses } = historyView(
      [expense({ categoryId: null, categoryName: null })],
      [],
    )
    expect(expenses[0].category).toBeNull()
  })

  it('falls back to Unknown when the payer name is missing', () => {
    const { expenses } = historyView([expense({ payerName: null })], [])
    expect(expenses[0].payer).toBe('Unknown')
  })

  it('preserves order (newest-first from the API)', () => {
    const { expenses, expenseCount } = historyView(
      [expense({ id: 'a' }), expense({ id: 'b' })],
      [],
    )
    expect(expenses.map((e) => e.id)).toEqual(['a', 'b'])
    expect(expenseCount).toBe(2)
  })
})

describe('historyView — settlements', () => {
  it('maps a completed settlement to a green badge row', () => {
    const { settlements } = historyView([], [settlement()])
    expect(settlements[0]).toEqual({
      id: 's1',
      from: 'Ada',
      to: 'Bo',
      date: 'Jun 17',
      amount: '20.00',
      currency: 'CAD',
      status: 'completed',
      statusLabel: 'COMPLETED',
    })
  })

  it('maps a pending settlement to a pending badge', () => {
    const { settlements } = historyView([], [settlement({ status: 'pending' })])
    expect(settlements[0].status).toBe('pending')
    expect(settlements[0].statusLabel).toBe('PENDING')
  })

  it('falls back to Unknown for missing direction names', () => {
    const { settlements } = historyView(
      [],
      [settlement({ fromUserName: null, toUserName: null })],
    )
    expect(settlements[0].from).toBe('Unknown')
    expect(settlements[0].to).toBe('Unknown')
  })
})

describe('historyView — counts and empty sections', () => {
  it('reports zero counts for an empty feed', () => {
    const v = historyView([], [])
    expect(v).toEqual({
      expenses: [],
      settlements: [],
      expenseCount: 0,
      settlementCount: 0,
    })
  })

  it('counts each section independently', () => {
    const v = historyView([expense()], [settlement(), settlement({ id: 's2' })])
    expect(v.expenseCount).toBe(1)
    expect(v.settlementCount).toBe(2)
  })
})
