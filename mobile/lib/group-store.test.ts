/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import { groupSubtitle, resolveActiveGroupId } from './group-store'
import type { ExpenseGroup } from '@/lib/api'

function group(id: string, over: Partial<ExpenseGroup> = {}): ExpenseGroup {
  return {
    id,
    name: `Group ${id}`,
    defaultCurrency: 'CAD',
    createdBy: 'u1',
    createdAt: '',
    deletedAt: null,
    members: [],
    categories: [],
    ...over,
  }
}

describe('resolveActiveGroupId', () => {
  const groups = [group('a'), group('b'), group('c')]

  it('keeps the stored id when it still exists', () => {
    expect(resolveActiveGroupId('b', groups)).toBe('b')
  })

  it('falls back to the first group when the stored id is gone', () => {
    expect(resolveActiveGroupId('zzz', groups)).toBe('a')
  })

  it('falls back to the first group when nothing is stored', () => {
    expect(resolveActiveGroupId(null, groups)).toBe('a')
    expect(resolveActiveGroupId(undefined, groups)).toBe('a')
  })

  it('returns null when there are no groups', () => {
    expect(resolveActiveGroupId('b', [])).toBeNull()
  })
})

describe('groupSubtitle', () => {
  it('pluralizes members and shows the currency', () => {
    const g = group('a', {
      defaultCurrency: 'EUR',
      members: [{} as any, {} as any],
    })
    expect(groupSubtitle(g)).toBe('2 members · EUR')
  })

  it('uses the singular for one member', () => {
    expect(groupSubtitle(group('a', { members: [{} as any] }))).toBe('1 member · CAD')
  })

  it('omits the currency when unset', () => {
    const g = group('a', { defaultCurrency: null, members: [{} as any] })
    expect(groupSubtitle(g)).toBe('1 member')
  })
})
