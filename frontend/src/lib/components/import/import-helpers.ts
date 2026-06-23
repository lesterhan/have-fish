import type { Account, ExpenseGroup, ParsedTransaction } from '$lib/api'

// The account-bearing slice of a RowState — the fields row-completeness depends on.
// Typed structurally so this helper module doesn't depend on the panel's RowState.
export type ImportRowAccounts = {
  offsetAccountId: string
  conversionAccountId: string
  feeAccountId: string
  expenseAccountId: string
  groupId: string | null
  kind: 'spend' | 'transfer'
}

// Single source of truth for "this row still needs an account assigned". Both the preview
// panel (to disable Confirm) and the commit handler (to block submit) call this, so the two
// gates can't drift apart.
export function rowMissingAccounts(tx: ParsedTransaction, row: ImportRowAccounts): boolean {
  if (tx.isTransfer === true) {
    // Shared spend → the Fish Pie cross-currency path derives the expense from the group,
    // so it only needs the bridge + fee (same as a convert).
    if (row.groupId) return !row.conversionAccountId || !row.feeAccountId
    if (row.kind === 'spend')
      return (
        !row.conversionAccountId ||
        !row.expenseAccountId ||
        (!!tx.feeAmount && !row.feeAccountId)
      )
    return !row.conversionAccountId || !row.feeAccountId
  }
  if (tx.isTransfer === 'same-currency')
    return !row.feeAccountId || !row.offsetAccountId
  // Regular row: a Fish Pie split derives its offset from the group; otherwise needs one.
  return !row.groupId && !row.offsetAccountId
}

// Resolve a currency's sub-account ID under a multi-currency root (e.g. assets:wise + "usd"
// → assets:wise:usd). Returns '' when the root or the sub-account doesn't exist.
export function accountIdForCurrency(
  accounts: Pick<Account, 'id' | 'path'>[],
  rootPath: string | null,
  currency: string,
): string {
  if (!rootPath) return ''
  const path = `${rootPath}:${currency.toLowerCase()}`
  return accounts.find((a) => a.path === path)?.id ?? ''
}

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
