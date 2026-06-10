import type { Account, ExpenseGroup } from '$lib/api'

export function groupName(groups: ExpenseGroup[], id: string | null): string {
  if (!id) return ''
  return groups.find((g) => g.id === id)?.name ?? ''
}

export function groupExpenseAccountPath(
  groups: ExpenseGroup[],
  accounts: Account[],
  currentUserId: string,
  groupId: string | null,
): string {
  if (!groupId) return ''
  const group = groups.find((g) => g.id === groupId)
  if (!group) return ''
  const member = group.members.find((m) => m.userId === currentUserId)
  if (!member || !member.defaultExpenseAccountId) return 'uncategorized'
  return accounts.find((a) => a.id === member.defaultExpenseAccountId)?.path ?? 'uncategorized'
}
