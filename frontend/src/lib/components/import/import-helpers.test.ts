/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { groupName, categoryName, myShareRatio } from './import-helpers'
import type { ExpenseGroup, GroupCategory, GroupMember } from '$lib/api'

const member = (userId: string, shareWeight: number, defaultExpenseAccountId: string | null): GroupMember =>
  ({ userId, shareWeight, defaultExpenseAccountId }) as GroupMember

const category = (
  id: string,
  name: string,
  opts: { archived?: boolean; mapping?: string; weights?: { userId: string; weight: number }[] } = {},
): GroupCategory =>
  ({
    id,
    name,
    archivedAt: opts.archived ? '2026-01-01' : null,
    myMapping: opts.mapping ? { accountId: opts.mapping } : null,
    weights: opts.weights ?? [],
  }) as GroupCategory

const group = (id: string, members: GroupMember[], categories: GroupCategory[]): ExpenseGroup =>
  ({ id, name: id, members, categories }) as ExpenseGroup

const g = group(
  'g1',
  [member('u1', 70, 'a-default'), member('u2', 30, null)],
  [
    category('c-food', 'Food', { mapping: 'a-food', weights: [{ userId: 'u1', weight: 60 }, { userId: 'u2', weight: 40 }] }),
    category('c-bare', 'Bare'),
  ],
)
const groups = [g]

describe('groupName', () => {
  it('returns the group name or empty for null', () => {
    expect(groupName(groups, 'g1')).toBe('g1')
    expect(groupName(groups, null)).toBe('')
    expect(groupName(groups, 'nope')).toBe('')
  })
})

describe('categoryName', () => {
  it('resolves a category name within a group', () => {
    expect(categoryName(groups, 'g1', 'c-food')).toBe('Food')
  })

  it('returns empty when either id is missing or unknown', () => {
    expect(categoryName(groups, 'g1', null)).toBe('')
    expect(categoryName(groups, null, 'c-food')).toBe('')
    expect(categoryName(groups, 'g1', 'nope')).toBe('')
  })
})

describe('myShareRatio', () => {
  it("uses the category's complete weight vector", () => {
    expect(myShareRatio(g, 'u1', 'c-food')).toBeCloseTo(0.6, 5)
    expect(myShareRatio(g, 'u2', 'c-food')).toBeCloseTo(0.4, 5)
  })

  it('falls back to member shareWeights when the category has no weights', () => {
    expect(myShareRatio(g, 'u1', 'c-bare')).toBeCloseTo(0.7, 5)
  })

  it('falls back to member shareWeights when no category given', () => {
    expect(myShareRatio(g, 'u1', null)).toBeCloseTo(0.7, 5)
  })

  it('returns null for an unknown member or missing group', () => {
    expect(myShareRatio(g, 'nobody', null)).toBeNull()
    expect(myShareRatio(undefined, 'u1', null)).toBeNull()
  })
})
