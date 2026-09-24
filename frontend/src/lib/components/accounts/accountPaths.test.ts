import { describe, expect, it } from 'bun:test'
import type { UserSettings } from '../../api'
import {
  accountDisplayName,
  bucketOf,
  DEFAULT_ROOTS,
  institutionOf,
  isUnderRoot,
  type Roots,
  rootFor,
  rootsFrom,
  shortPath,
  surfaceOf,
  surfaceOfPath,
} from './accountPaths'

const ROOTS: Roots = {
  assets: 'assets',
  liabilities: 'liabilities',
  equity: 'equity',
  expenses: 'expenses',
  income: 'income',
}

describe('isUnderRoot', () => {
  it('matches the root itself and anything below it', () => {
    expect(isUnderRoot('assets', 'assets')).toBe(true)
    expect(isUnderRoot('assets:wise:cad', 'assets')).toBe(true)
  })

  it('anchors on the separator so a shared prefix is not a match', () => {
    expect(isUnderRoot('assetsold:chequing', 'assets')).toBe(false)
    expect(isUnderRoot('assetsold', 'assets')).toBe(false)
  })

  it('treats an empty root as matching nothing rather than everything', () => {
    expect(isUnderRoot('assets:chequing', '')).toBe(false)
  })
})

describe('surfaceOfPath', () => {
  it('files each configured root', () => {
    expect(surfaceOfPath('assets:wise:cad', ROOTS)).toBe('assets')
    expect(surfaceOfPath('liabilities:visa', ROOTS)).toBe('liabilities')
    expect(surfaceOfPath('equity:tfsa', ROOTS)).toBe('equity')
    expect(surfaceOfPath('expenses:food', ROOTS)).toBe('expenses')
    expect(surfaceOfPath('income:salary', ROOTS)).toBe('income')
  })

  it('files anything outside every root as unfiled', () => {
    expect(surfaceOfPath('储蓄:中国银行', ROOTS)).toBe('unfiled')
    expect(surfaceOfPath('asset:typo', ROOTS)).toBe('unfiled')
  })

  it('follows renamed roots', () => {
    const custom: Roots = { ...ROOTS, assets: 'activos' }
    expect(surfaceOfPath('activos:banco', custom)).toBe('assets')
    // The old root is now just another unfiled path — which is the point of the bucket.
    expect(surfaceOfPath('assets:chequing', custom)).toBe('unfiled')
  })
})

describe('surfaceOf', () => {
  it('falls back to the path when the account carries no resolved type', () => {
    expect(surfaceOf({ path: 'assets:wise:cad' }, ROOTS)).toBe('assets')
    expect(surfaceOf({ path: '储蓄:中国银行' }, ROOTS)).toBe('unfiled')
    expect(surfaceOf({ path: 'assets:wise:cad', resolvedType: null }, ROOTS)).toBe('assets')
  })

  // BUG-007: the override is the whole point of the column, and reading the path instead
  // meant tagging an atypically-named wallet Cash left it exactly where it was — nowhere.
  it('files a tagged account by its type, wherever its path sits', () => {
    expect(surfaceOf({ path: '储蓄:现金', resolvedType: 'cash' }, ROOTS)).toBe('assets')
    expect(surfaceOf({ path: '储蓄:中国银行', resolvedType: 'asset' }, ROOTS)).toBe('assets')
    expect(surfaceOf({ path: '欠款:信用卡', resolvedType: 'liability' }, ROOTS)).toBe('liabilities')
    expect(surfaceOf({ path: '投资:股票', resolvedType: 'equity' }, ROOTS)).toBe('equity')
    expect(surfaceOf({ path: '花钱:房租', resolvedType: 'expense' }, ROOTS)).toBe('expenses')
    expect(surfaceOf({ path: '收入:工资', resolvedType: 'income' }, ROOTS)).toBe('income')
  })

  it('collapses the two hledger subtypes onto their parents', () => {
    expect(surfaceOf({ path: 'assets:cash:cad', resolvedType: 'cash' }, ROOTS)).toBe('assets')
    expect(surfaceOf({ path: 'equity:conversions', resolvedType: 'conversion' }, ROOTS)).toBe(
      'equity',
    )
  })

  it('lets the override win against the path, not only fill in for it', () => {
    // The same rule read backwards: a mis-pathed category under the assets root is a
    // category. Anything else would make the override mean "sometimes".
    expect(surfaceOf({ path: 'assets:groceries', resolvedType: 'expense' }, ROOTS)).toBe('expenses')
    expect(surfaceOf({ path: 'expenses:rrsp', resolvedType: 'equity' }, ROOTS)).toBe('equity')
  })
})

describe('bucketOf', () => {
  it('splits assets into cash and owed by the receivable subtree', () => {
    expect(bucketOf({ path: 'assets:wise:cad' }, ROOTS)).toBe('cash')
    expect(bucketOf({ path: 'assets:receivable:alice' }, ROOTS)).toBe('owed')
  })

  it('maps liabilities to owing and equity to investments', () => {
    expect(bucketOf({ path: 'liabilities:visa' }, ROOTS)).toBe('owing')
    expect(bucketOf({ path: 'equity:tfsa' }, ROOTS)).toBe('investments')
  })

  it('gives unfiled, expense and income accounts no bucket', () => {
    expect(bucketOf({ path: '储蓄:中国银行' }, ROOTS)).toBeNull()
    expect(bucketOf({ path: 'expenses:food' }, ROOTS)).toBeNull()
    expect(bucketOf({ path: 'income:salary' }, ROOTS)).toBeNull()
  })

  it('does not mistake a receivable-prefixed sibling for a receivable', () => {
    expect(bucketOf({ path: 'assets:receivables:old' }, ROOTS)).toBe('cash')
  })

  it('buckets a tagged account by its type', () => {
    expect(bucketOf({ path: '储蓄:现金', resolvedType: 'cash' }, ROOTS)).toBe('cash')
    expect(bucketOf({ path: '欠款:信用卡', resolvedType: 'liability' }, ROOTS)).toBe('owing')
    expect(bucketOf({ path: '投资:股票', resolvedType: 'equity' }, ROOTS)).toBe('investments')
    expect(bucketOf({ path: 'assets:groceries', resolvedType: 'expense' }, ROOTS)).toBeNull()
  })

  it('counts a tagged asset as spendable, since Owed is a subtree and not a type', () => {
    expect(bucketOf({ path: '储蓄:朋友欠我', resolvedType: 'asset' }, ROOTS)).toBe('cash')
  })
})

describe('shortPath', () => {
  it('strips the root prefix', () => {
    expect(shortPath('assets:wise:cad', 'assets')).toBe('wise:cad')
  })

  it('leaves a path that is not under the root alone', () => {
    expect(shortPath('储蓄:中国银行', 'assets')).toBe('储蓄:中国银行')
    expect(shortPath('assets', 'assets')).toBe('assets')
  })
})

describe('institutionOf', () => {
  it('reads path segment 2 when something sits below it', () => {
    expect(institutionOf('liabilities:wealthsimple:visa')).toBe('wealthsimple')
    expect(institutionOf('assets:wise:cad')).toBe('wise')
  })

  it('has none for a standalone account, which is not an institution of one', () => {
    // Otherwise a page of accounts becomes a page of one-row groups.
    expect(institutionOf('assets:chequing')).toBeNull()
    expect(institutionOf('assets')).toBeNull()
  })
})

describe('rootsFrom', () => {
  it('falls back to the schema defaults when settings have not loaded', () => {
    expect(rootsFrom(null)).toEqual(DEFAULT_ROOTS)
    expect(rootsFrom(undefined)).toEqual(DEFAULT_ROOTS)
  })

  it('reads every configured root, including income', () => {
    const settings = {
      defaultAssetsRootPath: 'activos',
      defaultLiabilitiesRootPath: 'pasivos',
      defaultEquityRootPath: 'capital',
      defaultExpensesRootPath: 'gastos',
      defaultIncomeRootPath: 'ingresos',
    } as UserSettings
    expect(rootsFrom(settings)).toEqual({
      assets: 'activos',
      liabilities: 'pasivos',
      equity: 'capital',
      expenses: 'gastos',
      income: 'ingresos',
    })
  })
})

describe('rootFor', () => {
  it('maps each surface to its configured root', () => {
    expect(rootFor('assets', ROOTS)).toBe('assets')
    expect(rootFor('income', ROOTS)).toBe('income')
  })

  it('gives unfiled no root, since it belongs to none', () => {
    expect(rootFor('unfiled', ROOTS)).toBe('')
  })
})

describe('accountDisplayName', () => {
  it('prefers the name', () => {
    expect(accountDisplayName({ path: 'assets:wise:cad', name: 'Wise CAD' }, 'assets')).toBe(
      'Wise CAD',
    )
  })

  it('falls back to the path with its root stripped', () => {
    expect(accountDisplayName({ path: 'assets:wise:cad' }, 'assets')).toBe('wise:cad')
  })

  it('keeps an unfiled path whole, since it has no root to strip', () => {
    expect(accountDisplayName({ path: '储蓄:中国银行' }, '')).toBe('储蓄:中国银行')
  })
})
