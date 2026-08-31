import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_ROOTS,
  accountDisplayName,
  bucketOf,
  institutionOf,
  isUnderRoot,
  rootFor,
  rootsFrom,
  shortPath,
  surfaceOf,
  type Roots,
} from './accountPaths'
import type { UserSettings } from '../../api'

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

describe('surfaceOf', () => {
  it('files each configured root', () => {
    expect(surfaceOf('assets:wise:cad', ROOTS)).toBe('assets')
    expect(surfaceOf('liabilities:visa', ROOTS)).toBe('liabilities')
    expect(surfaceOf('equity:tfsa', ROOTS)).toBe('equity')
    expect(surfaceOf('expenses:food', ROOTS)).toBe('expenses')
    expect(surfaceOf('income:salary', ROOTS)).toBe('income')
  })

  it('files anything outside every root as unfiled', () => {
    expect(surfaceOf('储蓄:中国银行', ROOTS)).toBe('unfiled')
    expect(surfaceOf('asset:typo', ROOTS)).toBe('unfiled')
  })

  it('follows renamed roots', () => {
    const custom: Roots = { ...ROOTS, assets: 'activos' }
    expect(surfaceOf('activos:banco', custom)).toBe('assets')
    // The old root is now just another unfiled path — which is the point of the bucket.
    expect(surfaceOf('assets:chequing', custom)).toBe('unfiled')
  })
})

describe('bucketOf', () => {
  it('splits assets into cash and owed by the receivable subtree', () => {
    expect(bucketOf('assets:wise:cad', ROOTS)).toBe('cash')
    expect(bucketOf('assets:receivable:alice', ROOTS)).toBe('owed')
  })

  it('maps liabilities to owing and equity to investments', () => {
    expect(bucketOf('liabilities:visa', ROOTS)).toBe('owing')
    expect(bucketOf('equity:tfsa', ROOTS)).toBe('investments')
  })

  it('gives unfiled, expense and income accounts no bucket', () => {
    expect(bucketOf('储蓄:中国银行', ROOTS)).toBeNull()
    expect(bucketOf('expenses:food', ROOTS)).toBeNull()
    expect(bucketOf('income:salary', ROOTS)).toBeNull()
  })

  it('does not mistake a receivable-prefixed sibling for a receivable', () => {
    expect(bucketOf('assets:receivables:old', ROOTS)).toBe('cash')
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
    expect(
      accountDisplayName({ path: 'assets:wise:cad', name: 'Wise CAD' }, 'assets'),
    ).toBe('Wise CAD')
  })

  it('falls back to the path with its root stripped', () => {
    expect(accountDisplayName({ path: 'assets:wise:cad' }, 'assets')).toBe(
      'wise:cad',
    )
  })

  it('keeps an unfiled path whole, since it has no root to strip', () => {
    expect(accountDisplayName({ path: '储蓄:中国银行' }, '')).toBe('储蓄:中国银行')
  })
})
