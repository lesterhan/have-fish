/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test'
import type { CurrencyBalance, GroupSettlement } from './api'
import { needsConversionAccount, pendingOutgoing, settleAction } from './settle-actions'
import type { SettleLine } from './fish-pie-settle'

const transfer = (from: string, to: string, amount: string, currency: string) => ({
  fromUserId: from,
  fromUserName: from,
  toUserId: to,
  toUserName: to,
  amount,
  currency,
})

const cad = (t: ReturnType<typeof transfer>): CurrencyBalance => ({
  currency: 'CAD',
  netPositions: [],
  transfers: [t],
})

function settlement(over: Partial<GroupSettlement>): GroupSettlement {
  return {
    id: 's1',
    groupId: 'g1',
    fromUserId: 'me',
    fromUserName: 'me',
    toUserId: 'partner',
    toUserName: 'Partner',
    amount: '500.00',
    currency: 'CAD',
    date: '2026-06-19',
    note: null,
    status: 'pending',
    payerAccountId: null,
    payerTransactionId: null,
    receiverTransactionId: null,
    batchId: 'b1',
    settledAmount: null,
    settledCurrency: null,
    fxRate: null,
    createdAt: '2026-06-19T00:00:00Z',
    deletedAt: null,
    ...over,
  }
}

const line = (over: Partial<SettleLine>): SettleLine => ({
  toUserId: 'partner',
  toUserName: 'Partner',
  debtAmount: '50.00',
  debtCurrency: 'EUR',
  include: true,
  convert: false,
  settledAmount: '',
  fxRate: null,
  asOfDate: null,
  ...over,
})

describe('settleAction', () => {
  it('is "settle" when the user owes someone', () => {
    expect(settleAction([cad(transfer('me', 'partner', '500.00', 'CAD'))], [], 'me')).toEqual({
      kind: 'settle',
    })
  })

  it('is "waiting" with the payer name when only owed', () => {
    expect(settleAction([cad(transfer('partner', 'me', '500.00', 'CAD'))], [], 'me')).toEqual({
      kind: 'waiting',
      payerName: 'partner',
    })
  })

  it('is "none" when nothing is outstanding', () => {
    expect(settleAction([], [], 'me')).toEqual({ kind: 'none' })
  })

  it('prefers "pending" over "settle" so the user cannot pay twice', () => {
    const balances = [cad(transfer('me', 'partner', '500.00', 'CAD'))]
    const settlements = [settlement({ status: 'pending', fromUserId: 'me', toUserName: 'Partner' })]
    expect(settleAction(balances, settlements, 'me')).toEqual({
      kind: 'pending',
      receiverName: 'Partner',
    })
  })

  it('ignores a completed or incoming or deleted settlement for the pending state', () => {
    const balances = [cad(transfer('me', 'partner', '500.00', 'CAD'))]
    expect(settleAction(balances, [settlement({ status: 'completed' })], 'me').kind).toBe('settle')
    expect(settleAction(balances, [settlement({ fromUserId: 'partner' })], 'me').kind).toBe('settle')
    expect(
      settleAction(balances, [settlement({ deletedAt: '2026-06-19T00:00:00Z' })], 'me').kind,
    ).toBe('settle')
  })
})

describe('pendingOutgoing', () => {
  it('returns only active pending rows the user is paying', () => {
    const rows = [
      settlement({ id: 'a', status: 'pending', fromUserId: 'me' }),
      settlement({ id: 'b', status: 'completed', fromUserId: 'me' }),
      settlement({ id: 'c', status: 'pending', fromUserId: 'partner' }),
      settlement({ id: 'd', status: 'pending', fromUserId: 'me', deletedAt: '2026-06-19T00:00:00Z' }),
    ]
    expect(pendingOutgoing(rows, 'me').map((r) => r.id)).toEqual(['a'])
  })
})

describe('needsConversionAccount', () => {
  it('is false when a conversion account is set', () => {
    expect(
      needsConversionAccount([line({ convert: true })], 'CAD', 'acct-1'),
    ).toBe(false)
  })

  it('is true when an included converted line lacks a conversion account', () => {
    expect(needsConversionAccount([line({ convert: true })], 'CAD', null)).toBe(true)
  })

  it('is false when the only converted line is excluded', () => {
    expect(needsConversionAccount([line({ convert: true, include: false })], 'CAD', null)).toBe(false)
  })

  it('is false for a native-only batch with no conversion account', () => {
    expect(
      needsConversionAccount([line({ debtCurrency: 'CAD', convert: false })], 'CAD', null),
    ).toBe(false)
  })
})
