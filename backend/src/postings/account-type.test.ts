import { describe, expect, it } from 'bun:test'
import {
  type AccountTypeContext,
  type AccountTypeRoots,
  DEFAULT_ROOTS,
  explainType,
  isAccountType,
  isStoredAccountType,
  resolveAccountType,
  resolveStoredOrInferredType,
  tagsFrom,
  toClassifierType,
} from './account-type'

const NO_TAGS: AccountTypeContext = { ...DEFAULT_ROOTS, tagged: new Map() }

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

describe('isAccountType', () => {
  it('accepts the five inferable types', () => {
    for (const t of ['asset', 'liability', 'equity', 'income', 'expense']) {
      expect(isAccountType(t)).toBe(true)
    }
  })

  it('rejects the override-only types and anything else', () => {
    // cash/conversion are valid stored overrides but NOT inferable types
    expect(isAccountType('cash')).toBe(false)
    expect(isAccountType('conversion')).toBe(false)
    expect(isAccountType('')).toBe(false)
    expect(isAccountType(null)).toBe(false)
    expect(isAccountType(undefined)).toBe(false)
    expect(isAccountType(5)).toBe(false)
  })
})

describe('isStoredAccountType', () => {
  it('accepts all seven hledger types', () => {
    for (const t of ['asset', 'cash', 'liability', 'equity', 'income', 'expense', 'conversion']) {
      expect(isStoredAccountType(t)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isStoredAccountType('revenue')).toBe(false) // hledger alias, but we store 'income'
    expect(isStoredAccountType('A')).toBe(false) // we store names, not codes
    expect(isStoredAccountType('')).toBe(false)
    expect(isStoredAccountType(null)).toBe(false)
    expect(isStoredAccountType(undefined)).toBe(false)
  })
})

describe('toClassifierType', () => {
  it('collapses the two override-only types to their parent bucket', () => {
    expect(toClassifierType('cash')).toBe('asset')
    expect(toClassifierType('conversion')).toBe('equity')
  })

  it('passes the five coarse types through unchanged', () => {
    expect(toClassifierType('asset')).toBe('asset')
    expect(toClassifierType('liability')).toBe('liability')
    expect(toClassifierType('equity')).toBe('equity')
    expect(toClassifierType('income')).toBe('income')
    expect(toClassifierType('expense')).toBe('expense')
  })
})

describe('resolveStoredOrInferredType', () => {
  it('uses a valid stored override over inference', () => {
    // path infers to expense, but the stored override says asset — override wins
    expect(resolveStoredOrInferredType({ path: 'expenses:food', type: 'asset' }, NO_TAGS)).toBe(
      'asset',
    )
  })

  it('falls back to inference when the stored type is null', () => {
    expect(resolveStoredOrInferredType({ path: 'expenses:food', type: null }, NO_TAGS)).toBe(
      'expense',
    )
  })

  it('resolves an atypical root via its stored override', () => {
    // inference returns null for these — the override is the only way they classify
    expect(resolveStoredOrInferredType({ path: '储蓄:中国银行', type: 'asset' }, NO_TAGS)).toBe(
      'asset',
    )
    expect(resolveStoredOrInferredType({ path: '花钱:房租', type: 'expense' }, NO_TAGS)).toBe(
      'expense',
    )
  })

  it('honours the override-only Cash and Conversion types', () => {
    // inference can never yield these; only a stored override can
    expect(resolveStoredOrInferredType({ path: 'assets:wise:cad', type: 'cash' }, NO_TAGS)).toBe(
      'cash',
    )
    expect(
      resolveStoredOrInferredType({ path: 'equity:conversion', type: 'conversion' }, NO_TAGS),
    ).toBe('conversion')
  })

  it('returns null for an atypical root with no stored override', () => {
    expect(resolveStoredOrInferredType({ path: '储蓄:中国银行', type: null }, NO_TAGS)).toBeNull()
  })

  it('ignores an invalid stored value and falls back to inference', () => {
    expect(resolveStoredOrInferredType({ path: 'assets:cash', type: 'bogus' }, NO_TAGS)).toBe(
      'asset',
    )
  })
})

// Decision #412: hledger's rule. An untagged account takes its nearest tagged ancestor's type,
// and a configured root is just an ancestor with a type.
describe('inheritance', () => {
  const ctx = (tags: [string, string][], roots: AccountTypeRoots = DEFAULT_ROOTS) => ({
    ...roots,
    tagged: tagsFrom(tags.map(([path, type]) => ({ path, type }))),
  })

  it("gives an untagged child its tagged parent's type", () => {
    const c = ctx([['花钱', 'expense']])
    expect(resolveStoredOrInferredType({ path: '花钱:房租', type: null }, c)).toBe('expense')
    expect(resolveStoredOrInferredType({ path: '花钱:房租:押金', type: null }, c)).toBe('expense')
  })

  it('takes the nearest tagged ancestor, not the topmost', () => {
    const c = ctx([
      ['储蓄', 'asset'],
      ['储蓄:现金', 'cash'],
    ])
    expect(resolveStoredOrInferredType({ path: '储蓄:现金:钱包', type: null }, c)).toBe('cash')
    expect(resolveStoredOrInferredType({ path: '储蓄:中国银行', type: null }, c)).toBe('asset')
  })

  it('lets a tagged ancestor below a root win over the root', () => {
    const c = ctx([['expenses:rrsp', 'asset']])
    expect(resolveStoredOrInferredType({ path: 'expenses:rrsp:tfsa', type: null }, c)).toBe('asset')
    expect(resolveStoredOrInferredType({ path: 'expenses:food', type: null }, c)).toBe('expense')
  })

  it('lets a root below a tagged ancestor win over the tag', () => {
    // Nearest wins in both directions: the root is the nearer source here.
    const c = ctx([['money', 'expense']], { ...DEFAULT_ROOTS, assetsRootPath: 'money:held' })
    expect(resolveStoredOrInferredType({ path: 'money:held:cad', type: null }, c)).toBe('asset')
  })

  it('lets a tag and a root at the same path be decided by the tag', () => {
    const c = ctx([['expenses', 'asset']])
    expect(resolveStoredOrInferredType({ path: 'expenses:food', type: null }, c)).toBe('asset')
  })

  it("never lets an ancestor override the account's own tag", () => {
    const c = ctx([['花钱', 'expense']])
    expect(resolveStoredOrInferredType({ path: '花钱:存款', type: 'asset' }, c)).toBe('asset')
  })

  it("reads the account's own level from its row, not from the tag map", () => {
    // The map says `花钱:房租` is tagged, but the row asks what Auto would be: its parent.
    const c = ctx([
      ['花钱', 'expense'],
      ['花钱:房租', 'asset'],
    ])
    expect(resolveStoredOrInferredType({ path: '花钱:房租', type: null }, c)).toBe('expense')
  })

  it('does not match a sibling that merely shares a prefix', () => {
    const c = ctx([['花钱', 'expense']])
    expect(resolveStoredOrInferredType({ path: '花钱多:x', type: null }, c)).toBeNull()
  })

  it('skips an invalid tag in the map', () => {
    const c = ctx([['花钱', 'bogus']])
    expect(resolveStoredOrInferredType({ path: '花钱:房租', type: null }, c)).toBeNull()
  })

  it('says where the type came from', () => {
    const c = ctx([['花钱', 'expense']])
    expect(explainType({ path: '花钱:房租', type: null }, c)).toEqual({
      type: 'expense',
      from: 'ancestor',
      path: '花钱',
    })
    expect(explainType({ path: 'assets:chq', type: null }, c)).toEqual({
      type: 'asset',
      from: 'root',
      path: 'assets',
    })
    expect(explainType({ path: 'x', type: 'cash' }, c)).toEqual({ type: 'cash', from: 'own' })
    expect(explainType({ path: '别的:x', type: null }, c)).toBeNull()
  })
})
