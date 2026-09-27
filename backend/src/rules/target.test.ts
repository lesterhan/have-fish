import { describe, expect, it } from 'bun:test'
import { namesTarget, readRuleTarget, targetColumns } from './target'

const A = '00000000-0000-4000-8000-00000000000a'
const G = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

describe('readRuleTarget', () => {
  it('reads an account target', () => {
    expect(readRuleTarget({ accountId: A })).toEqual({
      ok: true,
      value: { kind: 'account', accountId: A },
    })
  })

  it('reads a group target, with or without a category', () => {
    expect(readRuleTarget({ groupId: G })).toEqual({
      ok: true,
      value: { kind: 'group', groupId: G, categoryId: null },
    })
    expect(readRuleTarget({ groupId: G, categoryId: C, accountId: null })).toEqual({
      ok: true,
      value: { kind: 'group', groupId: G, categoryId: C },
    })
  })

  it('refuses both targets, neither, or a category on an account', () => {
    expect(readRuleTarget({ accountId: A, groupId: G })).toEqual({
      ok: false,
      failure: { error: 'RULE_TARGET_AMBIGUOUS' },
    })
    for (const input of [{}, { accountId: null, groupId: null }, { categoryId: C }]) {
      expect(readRuleTarget(input)).toEqual({
        ok: false,
        failure: { error: 'RULE_TARGET_MISSING' },
      })
    }
    expect(readRuleTarget({ accountId: A, categoryId: C })).toEqual({
      ok: false,
      failure: { error: 'RULE_CATEGORY_WITHOUT_GROUP' },
    })
  })

  it('says ambiguous before it says a category is misplaced', () => {
    expect(readRuleTarget({ accountId: A, groupId: G, categoryId: C })).toEqual({
      ok: false,
      failure: { error: 'RULE_TARGET_AMBIGUOUS' },
    })
  })
})

describe('namesTarget', () => {
  it('is true when any of the three keys is present, null included', () => {
    expect(namesTarget({ accountId: null })).toBe(true)
    expect(namesTarget({ categoryId: C })).toBe(true)
    expect(namesTarget({})).toBe(false)
  })
})

describe('targetColumns', () => {
  it('writes the other kind as null, so setting one clears the other', () => {
    expect(targetColumns({ kind: 'account', accountId: A })).toEqual({
      accountId: A,
      groupId: null,
      categoryId: null,
    })
    expect(targetColumns({ kind: 'group', groupId: G, categoryId: C })).toEqual({
      accountId: null,
      groupId: G,
      categoryId: C,
    })
  })
})
