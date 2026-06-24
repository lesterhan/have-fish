import { describe, it, expect } from 'bun:test'
import { resolveAccountType, DEFAULT_ROOTS, type AccountTypeRoots } from './account-type'

describe('resolveAccountType', () => {
  it('classifies each standard root', () => {
    expect(resolveAccountType('assets:wise:eur', DEFAULT_ROOTS)).toBe('asset')
    expect(resolveAccountType('liabilities:visa', DEFAULT_ROOTS)).toBe('liability')
    expect(resolveAccountType('equity:conversion', DEFAULT_ROOTS)).toBe('equity')
    expect(resolveAccountType('expenses:food:cafe', DEFAULT_ROOTS)).toBe('expense')
    expect(resolveAccountType('income:salary', DEFAULT_ROOTS)).toBe('income')
  })

  it('matches a bare root with no children', () => {
    expect(resolveAccountType('assets', DEFAULT_ROOTS)).toBe('asset')
    expect(resolveAccountType('income', DEFAULT_ROOTS)).toBe('income')
  })

  it('anchors on the colon — a root is not a substring match', () => {
    // `assetsfoo` is not under `assets`
    expect(resolveAccountType('assetsfoo:bank', DEFAULT_ROOTS)).toBeNull()
  })

  it('separates income from equity — the bug this fixes', () => {
    // Before the resolver, income collapsed to equity. They must be distinct.
    expect(resolveAccountType('income:salary', DEFAULT_ROOTS)).toBe('income')
    expect(resolveAccountType('equity:opening', DEFAULT_ROOTS)).toBe('equity')
  })

  it('returns null for atypically-named roots (deferred to stored type column)', () => {
    expect(resolveAccountType('储蓄:中国银行', DEFAULT_ROOTS)).toBeNull()
    expect(resolveAccountType('花钱:房租', DEFAULT_ROOTS)).toBeNull()
    expect(resolveAccountType('uncategorized', DEFAULT_ROOTS)).toBeNull()
  })

  it('respects custom per-user roots', () => {
    const roots: AccountTypeRoots = {
      assetsRootPath: 'assets',
      liabilitiesRootPath: 'liabilities',
      equityRootPath: 'equity',
      expensesRootPath: 'spending',
      incomeRootPath: 'earnings',
    }
    expect(resolveAccountType('spending:rent', roots)).toBe('expense')
    expect(resolveAccountType('earnings:job', roots)).toBe('income')
    // The default 'expenses' is no longer a known root under these settings
    expect(resolveAccountType('expenses:food', roots)).toBeNull()
  })

  it('picks the longest matching root when one root prefixes another', () => {
    const roots: AccountTypeRoots = {
      assetsRootPath: 'a',
      liabilitiesRootPath: 'liabilities',
      equityRootPath: 'equity',
      // expenses root is a deeper path that lives under the assets root
      expensesRootPath: 'a:spend',
      incomeRootPath: 'income',
    }
    expect(resolveAccountType('a:spend:food', roots)).toBe('expense')
    expect(resolveAccountType('a:bank', roots)).toBe('asset')
  })
})
