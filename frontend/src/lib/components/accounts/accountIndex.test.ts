/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { accountIndex, type IndexedAccount } from './accountIndex'

const ACCOUNTS: IndexedAccount[] = [
  { id: 'a1', path: 'expenses:food:groceries', freq: 118 },
  { id: 'a2', path: 'expenses:food:coffee', freq: 97 },
  { id: 'a3', path: 'assets:bank:chequing', freq: 142 },
]

describe('accountIndex — lookups', () => {
  it('maps path to account', () => {
    const idx = accountIndex(ACCOUNTS)
    expect(idx.byPath.get('expenses:food:coffee')?.id).toBe('a2')
  })

  it('maps id to account', () => {
    const idx = accountIndex(ACCOUNTS)
    expect(idx.byId.get('a3')?.path).toBe('assets:bank:chequing')
  })

  it('omits pure parent paths — they are tree nodes, not accounts', () => {
    const idx = accountIndex(ACCOUNTS)
    expect(idx.byPath.has('expenses:food')).toBe(false)
    expect(idx.tree.nodeAt('expenses:food')!.isAccount).toBe(false)
  })

  it('builds a tree over the same accounts', () => {
    const idx = accountIndex(ACCOUNTS)
    expect(idx.tree.childrenOf('').map((n) => n.name).sort()).toEqual([
      'assets',
      'expenses',
    ])
  })

  it('handles an empty list', () => {
    const idx = accountIndex([])
    expect(idx.byPath.size).toBe(0)
    expect(idx.byId.size).toBe(0)
    expect(idx.tree.childrenOf('')).toEqual([])
  })
})

describe('accountIndex — memoization', () => {
  it('reuses the index for the same array identity', () => {
    const list = [...ACCOUNTS]
    const first = accountIndex(list)
    const second = accountIndex(list)
    // Identity, not just equality — the whole point is that the second picker
    // over the same list does no work.
    expect(second).toBe(first)
    expect(second.tree).toBe(first.tree)
    expect(second.byPath).toBe(first.byPath)
  })

  it('builds a fresh index when the array is replaced', () => {
    const list = [...ACCOUNTS]
    const first = accountIndex(list)
    // How the app adds an account: replace, never mutate in place.
    const grown = [...list, { id: 'a4', path: 'expenses:travel', freq: 3 }]
    const second = accountIndex(grown)

    expect(second).not.toBe(first)
    expect(second.byId.get('a4')?.path).toBe('expenses:travel')
    // The original index is untouched and still valid for its own array.
    expect(first.byId.has('a4')).toBe(false)
    expect(accountIndex(list)).toBe(first)
  })

  it('keys on identity, so two equal-but-distinct arrays get separate indexes', () => {
    const a = [...ACCOUNTS]
    const b = [...ACCOUNTS]
    expect(accountIndex(a)).not.toBe(accountIndex(b))
    expect(accountIndex(b).byId.get('a1')?.path).toBe(accountIndex(a).byId.get('a1')?.path)
  })
})
