import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_KINDS,
  type AccountClass,
  type AccountKind,
  type AccountRoot,
  classOf,
  rootOf,
} from './account-kind'

const ACCOUNT_KINDS_TABLE: [AccountKind, AccountClass, AccountRoot][] = [
  ['card', 'liability', 'liabilities'],
  ['cash', 'asset', 'assets'],
  ['bank', 'asset', 'assets'],
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
