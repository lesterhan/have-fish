import { describe, expect, it } from 'bun:test'
import {
  ROOTS,
  accountLeaf,
  createSuggestion,
  filterAccounts,
  fuzzyMatch,
  resolveCreatePath,
  rootOf,
  type AccountLike,
} from './account-search'

const acct = (path: string, name?: string | null, id = path): AccountLike => ({ id, path, name })

const ACCOUNTS: AccountLike[] = [
  acct('expenses:groceries:veg'),
  acct('expenses:groceries:meat'),
  acct('expenses:dining'),
  acct('assets:cash', 'Wallet'),
  acct('assets:bank:checking'),
  acct('liabilities:visa'),
  acct('income:salary'),
]

describe('rootOf', () => {
  it('returns the first path segment, lowercased', () => {
    expect(rootOf('expenses:groceries:veg')).toBe('expenses')
    expect(rootOf('Assets:Cash')).toBe('assets')
  })
  it('handles a rootless single segment', () => {
    expect(rootOf('cash')).toBe('cash')
  })
  it('trims whitespace', () => {
    expect(rootOf('  expenses : x')).toBe('expenses')
  })
})

describe('accountLeaf', () => {
  it('prefers a human name when set', () => {
    expect(accountLeaf(acct('assets:cash', 'Wallet'))).toBe('Wallet')
  })
  it('falls back to the last segment when name is blank', () => {
    expect(accountLeaf(acct('expenses:groceries:veg', '  '))).toBe('veg')
    expect(accountLeaf(acct('expenses:groceries:veg', null))).toBe('veg')
  })
  it('returns the whole path for a rootless string', () => {
    expect(accountLeaf(acct('cash'))).toBe('cash')
  })
})

describe('fuzzyMatch', () => {
  it('matches a subsequence', () => {
    expect(fuzzyMatch('expenses:groceries:veg', 'exveg')).toBe(true)
    expect(fuzzyMatch('expenses:groceries:veg', 'groc')).toBe(true)
  })
  it('rejects out-of-order or absent chars', () => {
    expect(fuzzyMatch('expenses:groceries:veg', 'vegex')).toBe(false)
    expect(fuzzyMatch('assets:cash', 'xyz')).toBe(false)
  })
  it('is case-insensitive', () => {
    expect(fuzzyMatch('Assets:Cash', 'assets')).toBe(true)
  })
  it('matches everything on an empty needle', () => {
    expect(fuzzyMatch('anything', '')).toBe(true)
  })
})

describe('filterAccounts', () => {
  it('returns all, path-sorted, on an empty query', () => {
    const out = filterAccounts(ACCOUNTS, '').map((a) => a.path)
    expect(out).toEqual([
      'assets:bank:checking',
      'assets:cash',
      'expenses:dining',
      'expenses:groceries:meat',
      'expenses:groceries:veg',
      'income:salary',
      'liabilities:visa',
    ])
  })
  it('scopes to a root', () => {
    const out = filterAccounts(ACCOUNTS, '', 'expenses').map((a) => a.path)
    expect(out).toEqual(['expenses:dining', 'expenses:groceries:meat', 'expenses:groceries:veg'])
  })
  it('fuzzy-filters within scope', () => {
    const out = filterAccounts(ACCOUNTS, 'veg', 'expenses').map((a) => a.path)
    expect(out).toEqual(['expenses:groceries:veg'])
  })
  it('matches against the human name too', () => {
    const out = filterAccounts(ACCOUNTS, 'wallet').map((a) => a.path)
    expect(out).toEqual(['assets:cash'])
  })
  it('combines root scope and query', () => {
    expect(filterAccounts(ACCOUNTS, 'visa', 'expenses')).toEqual([])
  })
})

describe('resolveCreatePath', () => {
  it('prepends the active root to a bare leaf', () => {
    expect(resolveCreatePath('groceries:veg', 'expenses')).toBe('expenses:groceries:veg')
  })
  it('does not double-prefix an already-rooted path', () => {
    expect(resolveCreatePath('expenses:groceries:veg', 'expenses')).toBe('expenses:groceries:veg')
    expect(resolveCreatePath('assets:cash', 'expenses')).toBe('assets:cash')
  })
  it('uses the text as-is with no active root', () => {
    expect(resolveCreatePath('expenses:dining')).toBe('expenses:dining')
    expect(resolveCreatePath('misc')).toBe('misc')
  })
  it('trims surrounding and dangling colons / whitespace', () => {
    expect(resolveCreatePath('  veg:  ', 'expenses')).toBe('expenses:veg')
    expect(resolveCreatePath(':cash', 'assets')).toBe('assets:cash')
  })
  it('returns empty for blank input', () => {
    expect(resolveCreatePath('   ', 'expenses')).toBe('')
    expect(resolveCreatePath('')).toBe('')
  })
})

describe('createSuggestion', () => {
  it('offers a create for a new resolved path', () => {
    expect(createSuggestion(ACCOUNTS, 'groceries:fruit', 'expenses')).toEqual({
      path: 'expenses:groceries:fruit',
    })
  })
  it('suppresses create when the path already exists (case-insensitive)', () => {
    expect(createSuggestion(ACCOUNTS, 'groceries:veg', 'expenses')).toBeNull()
    expect(createSuggestion(ACCOUNTS, 'EXPENSES:DINING')).toBeNull()
  })
  it('returns null for blank input', () => {
    expect(createSuggestion(ACCOUNTS, '   ', 'expenses')).toBeNull()
  })
})

describe('ROOTS', () => {
  it('is the five canonical accounting roots in order', () => {
    expect(ROOTS).toEqual(['assets', 'liabilities', 'expenses', 'income', 'equity'])
  })
})
