/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import {
  owedDebts,
  initLines,
  isConverted,
  convertedAmount,
  linesReady,
  buildBatchLines,
  type SettleLine,
} from './fish-pie-settle'
import type { CurrencyBalance } from './api'

const transfer = (from: string, to: string, amount: string, currency: string) => ({
  fromUserId: from,
  fromUserName: from,
  toUserId: to,
  toUserName: to,
  amount,
  currency,
})

const balances: CurrencyBalance[] = [
  { currency: 'CAD', netPositions: [], transfers: [transfer('me', 'partner', '500.00', 'CAD')] },
  { currency: 'EUR', netPositions: [], transfers: [transfer('me', 'partner', '50.00', 'EUR')] },
]

const line = (over: Partial<SettleLine>): SettleLine => ({
  toUserId: 'partner',
  toUserName: 'partner',
  debtAmount: '50.00',
  debtCurrency: 'EUR',
  include: true,
  convert: false,
  settledAmount: '',
  fxRate: null,
  asOfDate: null,
  ...over,
})

describe('owedDebts', () => {
  it('extracts only the transfers where the current user is the debtor', () => {
    const mixed: CurrencyBalance[] = [
      { currency: 'CAD', netPositions: [], transfers: [transfer('me', 'partner', '500.00', 'CAD'), transfer('other', 'me', '10.00', 'CAD')] },
    ]
    const debts = owedDebts(mixed, 'me')
    expect(debts).toHaveLength(1)
    expect(debts[0]).toEqual({ toUserId: 'partner', toUserName: 'partner', amount: '500.00', currency: 'CAD' })
  })

  it('flattens debts across currencies', () => {
    expect(owedDebts(balances, 'me')).toHaveLength(2)
  })

  it('returns nothing when the user owes nobody', () => {
    expect(owedDebts(balances, 'partner')).toHaveLength(0)
  })
})

describe('initLines', () => {
  it('includes all lines and defaults convert on for non-target currencies', () => {
    const lines = initLines(owedDebts(balances, 'me'), 'CAD')
    expect(lines.every((l) => l.include)).toBe(true)
    const cad = lines.find((l) => l.debtCurrency === 'CAD')!
    const eur = lines.find((l) => l.debtCurrency === 'EUR')!
    expect(cad.convert).toBe(false) // same as target ⇒ native
    expect(eur.convert).toBe(true) // differs ⇒ convert for consolidation
  })
})

describe('isConverted', () => {
  it('is false when currencies match even if convert is on', () => {
    expect(isConverted(line({ debtCurrency: 'CAD', convert: true }), 'CAD')).toBe(false)
  })
  it('is true only when convert is on and currencies differ', () => {
    expect(isConverted(line({ debtCurrency: 'EUR', convert: true }), 'CAD')).toBe(true)
    expect(isConverted(line({ debtCurrency: 'EUR', convert: false }), 'CAD')).toBe(false)
  })
})

describe('convertedAmount', () => {
  it('multiplies and rounds to 2dp', () => {
    expect(convertedAmount('50.00', '1.60')).toBe('80.00')
    expect(convertedAmount('50.00', '1.4732')).toBe('73.66')
  })
  it('returns empty string without a rate', () => {
    expect(convertedAmount('50.00', null)).toBe('')
  })
})

describe('linesReady', () => {
  it('requires at least one included line', () => {
    expect(linesReady([line({ include: false })], 'CAD')).toBe(false)
  })
  it('passes a native line with no settled amount', () => {
    expect(linesReady([line({ debtCurrency: 'CAD', convert: false })], 'CAD')).toBe(true)
  })
  it('fails a converted line missing a positive settled amount', () => {
    expect(linesReady([line({ debtCurrency: 'EUR', convert: true, settledAmount: '' })], 'CAD')).toBe(false)
    expect(linesReady([line({ debtCurrency: 'EUR', convert: true, settledAmount: '80.00' })], 'CAD')).toBe(true)
  })
})

describe('buildBatchLines', () => {
  it('omits excluded lines (partial batch)', () => {
    const lines = [line({ debtCurrency: 'CAD', convert: false }), line({ include: false })]
    const built = buildBatchLines(lines, 'CAD')
    expect(built).toHaveLength(1)
  })

  it('native line mirrors settled to debt', () => {
    const built = buildBatchLines([line({ debtCurrency: 'CAD', debtAmount: '500.00', convert: false })], 'CAD')
    expect(built[0]).toEqual({ toUserId: 'partner', debtAmount: '500.00', debtCurrency: 'CAD', settledAmount: '500.00', settledCurrency: 'CAD' })
  })

  it('converted line carries the target currency, settled amount and rate', () => {
    const built = buildBatchLines(
      [line({ debtCurrency: 'EUR', debtAmount: '50.00', convert: true, settledAmount: '80.00', fxRate: '1.60' })],
      'CAD',
    )
    expect(built[0]).toEqual({
      toUserId: 'partner',
      debtAmount: '50.00',
      debtCurrency: 'EUR',
      settledAmount: '80.00',
      settledCurrency: 'CAD',
      fxRate: '1.60',
    })
  })

  it('a convert toggle on a same-currency line stays native', () => {
    const built = buildBatchLines([line({ debtCurrency: 'CAD', debtAmount: '500.00', convert: true })], 'CAD')
    expect(built[0].settledCurrency).toBe('CAD')
    expect(built[0].fxRate).toBeUndefined()
  })

  it('builds a mixed consolidated batch', () => {
    const lines = initLines(owedDebts(balances, 'me'), 'CAD')
    const eur = lines.find((l) => l.debtCurrency === 'EUR')!
    eur.settledAmount = '80.00'
    eur.fxRate = '1.60'
    const built = buildBatchLines(lines, 'CAD')
    expect(built).toHaveLength(2)
    const cad = built.find((b) => b.debtCurrency === 'CAD')!
    const eurOut = built.find((b) => b.debtCurrency === 'EUR')!
    expect(cad.settledCurrency).toBe('CAD')
    expect(eurOut.settledCurrency).toBe('CAD')
    expect(eurOut.settledAmount).toBe('80.00')
  })
})
