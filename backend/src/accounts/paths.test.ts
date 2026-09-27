import { describe, expect, it } from 'bun:test'
import { isClearingAccountPath, isValidPath, planRename } from './paths'

// No database: a rename is decided from the rows in hand. `routes/accounts.test.ts` covers
// the route and the write around it.

const tree = [
  { id: 'food', path: 'expenses:food' },
  { id: 'groceries', path: 'expenses:food:groceries' },
  { id: 'dining', path: 'expenses:food:dining' },
  { id: 'court', path: 'expenses:foodcourt' },
  { id: 'rent', path: 'expenses:rent' },
  { id: 'bank', path: 'assets:bank' },
]

const failure = (r: ReturnType<typeof planRename>) => (r.ok ? null : r.failure)

describe('planRename', () => {
  it('moves the node and every descendant, and nothing that only shares a prefix', () => {
    expect(planRename(tree, 'expenses:food', 'expenses:eating')).toEqual({
      ok: true,
      value: [
        { id: 'food', newPath: 'expenses:eating' },
        { id: 'groceries', newPath: 'expenses:eating:groceries' },
        { id: 'dining', newPath: 'expenses:eating:dining' },
      ],
    })
  })

  it('renames a virtual grouping node through its children', () => {
    // `expenses` has no row of its own; its children carry it.
    const r = planRename(tree, 'expenses', 'spending')
    expect(r.ok && r.value.map((w) => w.newPath)).toEqual([
      'spending:food',
      'spending:food:groceries',
      'spending:food:dining',
      'spending:foodcourt',
      'spending:rent',
    ])
  })

  it('renames a leaf alone', () => {
    expect(planRename(tree, 'expenses:rent', 'expenses:housing:rent')).toEqual({
      ok: true,
      value: [{ id: 'rent', newPath: 'expenses:housing:rent' }],
    })
  })

  it('moves a subtree into itself, since every path in it moves too', () => {
    const r = planRename(tree, 'expenses:food', 'expenses:food:all')
    expect(r.ok && r.value.map((w) => w.newPath)).toEqual([
      'expenses:food:all',
      'expenses:food:all:groceries',
      'expenses:food:all:dining',
    ])
  })

  it('treats LIKE wildcards as the characters they are', () => {
    const odd = [
      { id: 'a', path: 'x:a_b' },
      { id: 'b', path: 'x:axb' },
      { id: 'c', path: 'x:100%' },
    ]
    expect(planRename(odd, 'x:a_b', 'x:ab')).toEqual({
      ok: true,
      value: [{ id: 'a', newPath: 'x:ab' }],
    })
    expect(planRename(odd, 'x:100%', 'x:all')).toEqual({
      ok: true,
      value: [{ id: 'c', newPath: 'x:all' }],
    })
  })

  it('refuses a target that an account outside the subtree already holds', () => {
    expect(failure(planRename(tree, 'expenses:food', 'expenses:rent'))).toEqual({
      error: 'RENAME_TARGET_EXISTS',
      detail: { path: 'expenses:rent' },
    })
    // A descendant landing on an existing path is a collision too.
    const withTarget = [...tree, { id: 'eg', path: 'expenses:eating:groceries' }]
    expect(failure(planRename(withTarget, 'expenses:food', 'expenses:eating'))).toEqual({
      error: 'RENAME_TARGET_EXISTS',
      detail: { path: 'expenses:eating:groceries' },
    })
  })

  it('refuses a rename that matches nothing', () => {
    expect(failure(planRename(tree, 'expenses:fo', 'expenses:x'))).toEqual({
      error: 'RENAME_NO_MATCH',
    })
    expect(failure(planRename([], 'a', 'b'))).toEqual({ error: 'RENAME_NO_MATCH' })
  })

  it('refuses the same path, and a malformed target, before looking at the accounts', () => {
    expect(failure(planRename(tree, 'expenses:food', 'expenses:food'))).toEqual({
      error: 'RENAME_TARGET_SAME_AS_SOURCE',
    })
    for (const to of ['', ' x', 'x:', 'x::y', ':x']) {
      expect(failure(planRename(tree, 'expenses:food', to))).toEqual({
        error: 'RENAME_TARGET_INVALID',
      })
    }
  })

  it('keeps accounts out of and in the receivable namespace', () => {
    const withReceivable = [...tree, { id: 'r', path: 'assets:receivable:trip' }]
    expect(failure(planRename(withReceivable, 'assets:receivable:trip', 'assets:trip'))).toEqual({
      error: 'RECEIVABLE_NOT_RENAMABLE',
    })
    expect(failure(planRename(withReceivable, 'assets:bank', 'assets:receivable:bank'))).toEqual({
      error: 'RECEIVABLE_NOT_A_RENAME_TARGET',
    })
  })

  it('refuses in a fixed order when more than one rule is broken', () => {
    // Same path wins over receivable; receivable source wins over receivable target.
    expect(failure(planRename(tree, 'assets:receivable', 'assets:receivable'))).toEqual({
      error: 'RENAME_TARGET_SAME_AS_SOURCE',
    })
    expect(failure(planRename(tree, 'assets:receivable', 'assets:receivable:x'))).toEqual({
      error: 'RECEIVABLE_NOT_RENAMABLE',
    })
  })
})

describe('isValidPath', () => {
  it('accepts colon-separated segments', () => {
    for (const path of ['assets', 'assets:bank', '储蓄:中国银行', 'a b:c']) {
      expect(isValidPath(path)).toBe(true)
    }
  })

  it('refuses empty segments and surrounding whitespace', () => {
    for (const path of ['', ' ', ':x', 'x:', 'x::y', ' x', 'x ', 'x: y', 'x :y']) {
      expect(isValidPath(path)).toBe(false)
    }
  })
})

describe('isClearingAccountPath', () => {
  it('matches the namespace and what is under it, anchored on the colon', () => {
    expect(isClearingAccountPath('assets:receivable')).toBe(true)
    expect(isClearingAccountPath('assets:receivable:trip')).toBe(true)
    expect(isClearingAccountPath('assets:receivables-ledger')).toBe(false)
    expect(isClearingAccountPath('assets')).toBe(false)
  })
})
