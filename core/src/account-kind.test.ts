import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_KINDS,
  type AccountClass,
  type AccountKind,
  type AccountRoot,
  ADDABLE_KINDS,
  classOf,
  isAddable,
  rootOf,
} from './account-kind'

const ACCOUNT_KINDS_TABLE: [AccountKind, AccountClass, AccountRoot][] = [
  ['card', 'liability', 'liabilities'],
  ['cash', 'asset', 'assets'],
  ['bank', 'asset', 'assets'],
  ['loan', 'liability', 'liabilities'],
  ['category', 'expense', 'expenses'],
  ['income', 'income', 'income'],
  ['opening', 'equity', 'equity'],
  ['conversion', 'equity', 'equity'],
]

describe('classOf and rootOf', () => {
  it.each(ACCOUNT_KINDS_TABLE)('%s is class %s, under %s', (kind, accountClass, root) => {
    expect(classOf(kind)).toBe(accountClass)
    expect(rootOf(kind)).toBe(root)
  })

  it.each(ACCOUNT_KINDS)('%s has class and root', (kind) => {
    expect(classOf(kind)).toBeDefined()
    expect(rootOf(kind)).toBeDefined()
  })

  it('classOf unsupported kind does not compile', () => {
    // @ts-expect-error 'mortage' is not unsupported
    classOf('mortage')
  })
})

describe('ADDABLE_KINDS', () => {
  it('are what I have and what I owe, never a category, income or equity', () => {
    expect(ADDABLE_KINDS.map(classOf)).toEqual(['asset', 'asset', 'liability', 'liability'])
  })

  it('isAddable says which kinds those are', () => {
    expect(ACCOUNT_KINDS.filter(isAddable)).toEqual(['card', 'cash', 'bank', 'loan'])
  })
})
