import { describe, expect, it } from 'bun:test'
import {
  convertedTotal,
  monthlyTotals,
  monthWindow,
  rateKey,
  ratesNeeded,
  type SpendLeg,
  summarizeSpending,
} from './spending'

const row = (path: string, amount: string, currency = 'CAD', date = '2026-03-10'): SpendLeg => ({
  path,
  amount,
  currency,
  date,
})

describe('summarizeSpending', () => {
  const rows = [
    row('expenses:food:groceries', '10.10'),
    row('expenses:food:dining', '5.20'),
    row('expenses:food', '1.00'),
    row('expenses:rent', '1000.00'),
    row('expenses:food:dining', '3.00', 'EUR'),
    row('misc', '0.10'),
  ]

  it('buckets by the first two segments, counting drillable children', () => {
    expect(summarizeSpending(rows, null)).toEqual({
      total: { CAD: '1016.40', EUR: '3.00' },
      categories: [
        { category: 'expenses:food', total: { CAD: '16.30', EUR: '3.00' }, childCount: 2 },
        { category: 'expenses:rent', total: { CAD: '1000.00' }, childCount: 0 },
        { category: 'misc', total: { CAD: '0.10' }, childCount: 0 },
      ],
    })
  })

  it('goes one level below a prefix', () => {
    const food = rows.filter((r) => r.path.startsWith('expenses:food'))
    expect(summarizeSpending(food, 'expenses:food').categories).toEqual([
      { category: 'expenses:food:groceries', total: { CAD: '10.10' }, childCount: 0 },
      { category: 'expenses:food:dining', total: { CAD: '5.20', EUR: '3.00' }, childCount: 0 },
      { category: 'expenses:food', total: { CAD: '1.00' }, childCount: 0 },
    ])
  })
})

describe('monthWindow', () => {
  it('spans whole months ending with the current one', () => {
    expect(monthWindow(new Date('2026-03-15T12:00:00Z'), 3)).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      keys: ['2026-01', '2026-02', '2026-03'],
    })
  })

  it('crosses a year boundary', () => {
    expect(monthWindow(new Date('2026-01-31T23:59:59Z'), 2)).toEqual({
      from: '2025-12-01',
      to: '2026-01-31',
      keys: ['2025-12', '2026-01'],
    })
  })
})

describe('monthlyTotals', () => {
  it('fills every month, empty ones included, and skips rows outside', () => {
    const rows = [
      row('expenses:a', '0.10', 'CAD', '2026-02-01'),
      row('expenses:a', '0.20', 'CAD', '2026-02-28'),
      row('expenses:a', '9.99', 'CAD', '2025-12-31'),
    ]
    expect(monthlyTotals(rows, ['2026-01', '2026-02'])).toEqual([
      { month: '2026-01', total: {} },
      { month: '2026-02', total: { CAD: '0.30' } },
    ])
  })
})

describe('ratesNeeded and convertedTotal', () => {
  const rows = [
    row('expenses:a', '10.00', 'EUR', '2026-03-01'),
    row('expenses:a', '5.00', 'CAD', '2026-03-01'),
    row('expenses:a', '2.00', 'EUR', '2026-03-01'),
    row('expenses:a', '1.00', 'JPY', '2026-03-02'),
  ]

  it('needs each (day, currency) once, in first-seen order, and none for the target', () => {
    expect(ratesNeeded(rows, 'CAD')).toEqual([
      { date: '2026-03-01', from: 'EUR' },
      { date: '2026-03-02', from: 'JPY' },
    ])
  })

  it('converts in cents and rounds once, half away from zero', () => {
    const rates = new Map([
      [rateKey('2026-03-01', 'EUR'), '1.500000'],
      [rateKey('2026-03-02', 'JPY'), '0.005000'],
    ])
    // 5.00 + (10.00 + 2.00) × 1.5 + 1.00 × 0.005 = 23.005 → 23.01
    expect(convertedTotal(rows, 'CAD', rates)).toBe('23.01')
    expect(convertedTotal([row('x', '-1.00', 'JPY', '2026-03-02')], 'CAD', rates)).toBe('-0.01')
  })

  it('is null when a rate is missing', () => {
    expect(convertedTotal(rows, 'CAD', new Map())).toBeNull()
  })
})
