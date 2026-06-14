import type { Account, ExpenseGroup } from '$lib/api'

export function groupName(groups: ExpenseGroup[], id: string | null): string {
  if (!id) return ''
  return groups.find((g) => g.id === id)?.name ?? ''
}

export function categoryName(
  groups: ExpenseGroup[],
  groupId: string | null,
  categoryId: string | null,
): string {
  if (!groupId || !categoryId) return ''
  const group = groups.find((g) => g.id === groupId)
  return group?.categories.find((c) => c.id === categoryId)?.name ?? ''
}

export function groupExpenseAccountPath(
  groups: ExpenseGroup[],
  accounts: Account[],
  currentUserId: string,
  groupId: string | null,
  categoryId: string | null = null,
): string {
  if (!groupId) return ''
  const group = groups.find((g) => g.id === groupId)
  if (!group) return ''
  // The category's private mapping wins over the member default, matching the
  // backend's per-member account resolution order.
  if (categoryId) {
    const mappedId = group.categories.find((c) => c.id === categoryId)?.myMapping?.accountId
    if (mappedId) return accounts.find((a) => a.id === mappedId)?.path ?? 'uncategorized'
  }
  const member = group.members.find((m) => m.userId === currentUserId)
  if (!member || !member.defaultExpenseAccountId) return 'uncategorized'
  return accounts.find((a) => a.id === member.defaultExpenseAccountId)?.path ?? 'uncategorized'
}

// My share of an expense, as a 0..1 ratio. Prefers the category's complete weight
// vector (when every member has a weight); otherwise falls back to the group's
// member shareWeights — the same precedence the backend uses for splits.
export function myShareRatio(
  group: ExpenseGroup | undefined,
  currentUserId: string,
  categoryId: string | null,
): number | null {
  if (!group) return null
  const cat = categoryId ? group.categories.find((c) => c.id === categoryId) : null
  if (cat && cat.weights.length === group.members.length) {
    const total = cat.weights.reduce((s, w) => s + w.weight, 0)
    const mine = cat.weights.find((w) => w.userId === currentUserId)?.weight
    if (total > 0 && mine !== undefined) return mine / total
  }
  const totalWeight = group.members.reduce((s, m) => s + m.shareWeight, 0)
  if (totalWeight === 0) return null
  const me = group.members.find((m) => m.userId === currentUserId)
  return me ? me.shareWeight / totalWeight : null
}
