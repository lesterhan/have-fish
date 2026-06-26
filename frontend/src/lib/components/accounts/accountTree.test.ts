/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { buildTree, type TreeAccount } from './accountTree'

const ACCOUNTS: TreeAccount[] = [
  { path: 'expenses:food:groceries', freq: 118 },
  { path: 'expenses:food:coffee', freq: 97 },
  { path: 'expenses:food:coffee:starbucks', freq: 12 },
  { path: 'expenses:housing:rent', freq: 36 },
  { path: 'assets:bank:chequing', freq: 142 },
]

describe('buildTree — structure', () => {
  it('exposes top-level segments as roots', () => {
    const tree = buildTree(ACCOUNTS)
    const roots = tree.childrenOf('').map((n) => n.name)
    expect(roots.sort()).toEqual(['assets', 'expenses'])
  })

  it('marks leaf accounts vs. pure parents', () => {
    const tree = buildTree(ACCOUNTS)
    expect(tree.nodeAt('expenses:food')!.isAccount).toBe(false)
    expect(tree.nodeAt('expenses:food:coffee')!.isAccount).toBe(true)
    // coffee is both an account AND a parent (has :starbucks under it).
    expect(tree.nodeAt('expenses:food:coffee')!.children.has('starbucks')).toBe(true)
  })

  it('returns null for a path that does not exist', () => {
    expect(buildTree(ACCOUNTS).nodeAt('expenses:nope')).toBeNull()
  })

  it('returns the root for an empty path', () => {
    expect(buildTree(ACCOUNTS).nodeAt('')!.path).toBe('')
  })

  it('returns [] children for an unknown path', () => {
    expect(buildTree(ACCOUNTS).childrenOf('does:not:exist')).toEqual([])
  })
})

describe('buildTree — frequency', () => {
  it('bubbles subtree freq up to parents', () => {
    const tree = buildTree(ACCOUNTS)
    // expenses = groceries 118 + coffee 97 + starbucks 12 + rent 36 = 263
    expect(tree.nodeAt('expenses')!.freq).toBe(263)
    // food = groceries 118 + coffee 97 + starbucks 12 = 227
    expect(tree.nodeAt('expenses:food')!.freq).toBe(227)
    // coffee = its own 97 + starbucks 12 = 109
    expect(tree.nodeAt('expenses:food:coffee')!.freq).toBe(109)
  })

  it('sorts children by subtree freq descending', () => {
    const tree = buildTree(ACCOUNTS)
    // assets subtree 142 vs expenses subtree 263 → expenses first.
    expect(tree.childrenOf('').map((n) => n.name)).toEqual(['expenses', 'assets'])
  })
})

describe('buildTree — alphabetical fallback when freq absent', () => {
  it('orders zero-freq siblings by path', () => {
    const tree = buildTree([
      { path: 'expenses:utilities:phone' },
      { path: 'expenses:utilities:internet' },
      { path: 'expenses:utilities:electricity' },
    ])
    expect(tree.childrenOf('expenses:utilities').map((n) => n.name)).toEqual([
      'electricity',
      'internet',
      'phone',
    ])
  })
})
