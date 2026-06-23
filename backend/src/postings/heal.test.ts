import { describe, it, expect } from 'bun:test'
import { detectMalformedFxSpend, planFxSpendRepair, type HealPosting, type HealSettings } from './heal'

const settings: HealSettings = {
  expensesRootPath: 'expenses',
  assetsRootPath: 'assets',
  liabilitiesRootPath: 'liabilities',
  equityRootPath: 'equity',
}

// The canonical malformed shape: coffee for 360 CZK funded from USD, no CZK held.
const malformed: HealPosting[] = [
  { id: 'p1', accountId: 'usd',    accountPath: 'assets:bank:savings:usd', amount: '-17.29', currency: 'USD' },
  { id: 'p2', accountId: 'coffee', accountPath: 'expenses:food:coffee',    amount: '17.24',  currency: 'USD' },
  { id: 'p3', accountId: 'fee',    accountPath: 'expenses:banking',        amount: '0.05',   currency: 'USD' },
  { id: 'p4', accountId: 'coffee', accountPath: 'expenses:food:coffee',    amount: '-360.00', currency: 'CZK' },
  { id: 'p5', accountId: 'czk',    accountPath: 'assets:bank:savings:czk', amount: '360.00',  currency: 'CZK' },
]

describe('detectMalformedFxSpend', () => {
  it('detects the canonical malformed cross-currency spend', () => {
    const finding = detectMalformedFxSpend(malformed, settings)
    expect(finding).not.toBeNull()
    expect(finding!.expenseAccountId).toBe('coffee')
    expect(finding!.sourceBridgePostingId).toBe('p2') // +17.24 USD
    expect(finding!.targetBridgePostingId).toBe('p4') // -360 CZK
    expect(finding!.phantomPostingId).toBe('p5')      // +360 CZK on the asset
    expect(finding!.sourceCurrency).toBe('USD')
    expect(finding!.targetCurrency).toBe('CZK')
  })

  it('does not flag a healthy cross-currency spend (has an equity bridge)', () => {
    const healthy: HealPosting[] = [
      { id: 'p1', accountId: 'usd',    accountPath: 'assets:bank:savings:usd', amount: '-17.29', currency: 'USD' },
      { id: 'p2', accountId: 'equity', accountPath: 'equity:conversions',      amount: '17.24',  currency: 'USD' },
      { id: 'p3', accountId: 'fee',    accountPath: 'expenses:banking',        amount: '0.05',   currency: 'USD' },
      { id: 'p4', accountId: 'equity', accountPath: 'equity:conversions',      amount: '-360.00', currency: 'CZK' },
      { id: 'p5', accountId: 'coffee', accountPath: 'expenses:food:coffee',    amount: '360.00',  currency: 'CZK' },
    ]
    expect(detectMalformedFxSpend(healthy, settings)).toBeNull()
  })

  it('does not flag a genuine convert-and-hold (asset→asset, equity bridge, no double expense)', () => {
    const convert: HealPosting[] = [
      { id: 'p1', accountId: 'fee',    accountPath: 'expenses:banking:fee:wise', amount: '2.34',     currency: 'EUR' },
      { id: 'p2', accountId: 'eur',    accountPath: 'assets:wise:eur',           amount: '-497.66',  currency: 'EUR' },
      { id: 'p3', accountId: 'equity', accountPath: 'equity:conversions',        amount: '495.32',   currency: 'EUR' },
      { id: 'p4', accountId: 'equity', accountPath: 'equity:conversions',        amount: '-3949.90', currency: 'CNY' },
      { id: 'p5', accountId: 'cny',    accountPath: 'assets:wise:cny',           amount: '3949.90',  currency: 'CNY' },
    ]
    expect(detectMalformedFxSpend(convert, settings)).toBeNull()
  })

  it('does not flag a plain single-currency expense', () => {
    const plain: HealPosting[] = [
      { id: 'p1', accountId: 'chq',    accountPath: 'assets:bank:chequing',  amount: '-45.20', currency: 'CAD' },
      { id: 'p2', accountId: 'food',   accountPath: 'expenses:food:groceries', amount: '45.20', currency: 'CAD' },
    ]
    expect(detectMalformedFxSpend(plain, settings)).toBeNull()
  })

  it('respects custom root paths (cost/funds instead of expenses/assets)', () => {
    const custom = malformed.map((p) => ({
      ...p,
      accountPath: p.accountPath.replace(/^expenses/, 'cost').replace(/^assets/, 'funds'),
    }))
    const customSettings: HealSettings = {
      expensesRootPath: 'cost',
      assetsRootPath: 'funds',
      liabilitiesRootPath: 'debt',
      equityRootPath: 'equity',
    }
    const finding = detectMalformedFxSpend(custom, customSettings)
    expect(finding).not.toBeNull()
    expect(finding!.expenseAccountId).toBe('coffee')
  })

  it('does not flag when the expense account appears in only one currency', () => {
    // expense leg is single-currency; the +360 is just a sibling asset move — not the bug.
    const single: HealPosting[] = [
      { id: 'p1', accountId: 'usd',    accountPath: 'assets:bank:savings:usd', amount: '-17.29', currency: 'USD' },
      { id: 'p2', accountId: 'coffee', accountPath: 'expenses:food:coffee',    amount: '17.29',  currency: 'USD' },
      { id: 'p3', accountId: 'czk',    accountPath: 'assets:bank:savings:czk', amount: '360.00', currency: 'CZK' },
      { id: 'p4', accountId: 'czk2',   accountPath: 'assets:other:czk',        amount: '-360.00', currency: 'CZK' },
    ]
    expect(detectMalformedFxSpend(single, settings)).toBeNull()
  })
})

describe('planFxSpendRepair', () => {
  it('repoints both bridge legs to the conversion account and the phantom to the expense', () => {
    const finding = detectMalformedFxSpend(malformed, settings)!
    const repoints = planFxSpendRepair(finding, 'equity-acc')

    expect(repoints).toEqual([
      { postingId: 'p2', toAccountId: 'equity-acc' },
      { postingId: 'p4', toAccountId: 'equity-acc' },
      { postingId: 'p5', toAccountId: 'coffee' },
    ])
  })

  it('repair preserves the per-currency balance (amounts unchanged)', () => {
    const finding = detectMalformedFxSpend(malformed, settings)!
    const repoints = planFxSpendRepair(finding, 'equity-acc')
    const byId = new Map(repoints.map((r) => [r.postingId, r.toAccountId]))

    // In the real flow the joined path follows the repointed account; mirror that here so
    // the idempotency check is meaningful.
    const pathByAccount: Record<string, string> = {
      'equity-acc': 'equity:conversions',
      coffee: 'expenses:food:coffee',
    }
    const repaired = malformed.map((p) => {
      const toAccountId = byId.get(p.id)
      if (!toAccountId) return p
      return { ...p, accountId: toAccountId, accountPath: pathByAccount[toAccountId] ?? p.accountPath }
    })
    const sumBy = (ccy: string) =>
      repaired.filter((p) => p.currency === ccy).reduce((a, p) => a + parseFloat(p.amount), 0)
    expect(Math.abs(sumBy('USD'))).toBeLessThan(0.001)
    expect(Math.abs(sumBy('CZK'))).toBeLessThan(0.001)

    // Idempotent: the repaired shape now has an equity bridge, so it is no longer detected.
    expect(detectMalformedFxSpend(repaired, settings)).toBeNull()
  })
})
