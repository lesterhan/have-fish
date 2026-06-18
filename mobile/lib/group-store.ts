import type { ExpenseGroup } from '@/lib/api'

/** AsyncStorage key for the last-visited group — the Companion shell opens here. */
export const LAST_GROUP_KEY = 'havefish_last_group'

/**
 * Resolve which group the shell should open on, given the persisted last-visited
 * id and the freshly fetched group list. Falls back to the first group when the
 * stored id is missing or no longer exists (left/deleted group). Returns `null`
 * only when the user has no groups.
 */
export function resolveActiveGroupId(
  storedId: string | null | undefined,
  groups: ExpenseGroup[],
): string | null {
  if (groups.length === 0) return null
  if (storedId && groups.some((g) => g.id === storedId)) return storedId
  return groups[0]!.id
}

/** Header sub-line: "{n} member(s) · {ccy}" (ccy omitted when unset). */
export function groupSubtitle(group: ExpenseGroup): string {
  const n = group.members.length
  const members = `${n} member${n === 1 ? '' : 's'}`
  return group.defaultCurrency ? `${members} · ${group.defaultCurrency}` : members
}
