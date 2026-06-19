/**
 * Pure selectors for the Add screen's group-driven controls (paid-by segments,
 * category rail). Kept free of any React Native / expo import so they unit-test
 * under `bun test`; the API types are imported type-only (erased at compile, so
 * the RN-touching `api.ts` module is never loaded at test runtime).
 */

import type { ExpenseGroup, GroupCategory } from './api'

/**
 * Active categories for the group, in their configured order. Categories are
 * created/mapped on the web app; mobile only picks among them. Archived ones
 * are excluded.
 */
export function activeCategories(group: ExpenseGroup): GroupCategory[] {
  return group.categories
    .filter((c) => c.archivedAt == null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * A member's share as a whole-number percentage of the group's total weight.
 * The Add screen shows this as a read-only hint ("50% share"); the actual split
 * is the group-configured weight vector resolved server-side. Returns 0 when the
 * member is unknown or the weights sum to zero (avoids divide-by-zero).
 */
export function memberSharePct(group: ExpenseGroup, userId: string): number {
  const total = group.members.reduce((sum, m) => sum + (m.shareWeight || 0), 0)
  if (total <= 0) return 0
  const member = group.members.find((m) => m.userId === userId)
  if (!member) return 0
  return Math.round((member.shareWeight / total) * 100)
}

/**
 * The payment account an expense posts from when a given member is the payer —
 * that member's per-group default. `createExpense` requires it; Story 5 gates
 * submit on its presence. Recomputed whenever the payer toggle changes. Null
 * when the member is unknown or has no default configured (set on web).
 */
export function payerDefaultAccountId(group: ExpenseGroup, paidByUserId: string): string | null {
  return group.members.find((m) => m.userId === paidByUserId)?.defaultPaymentAccountId ?? null
}

/**
 * Resolve which member is the caller, by email match. Used to pre-select the
 * caller as the default payer. Null when the caller isn't a member (shouldn't
 * happen for a group they can open, but handled).
 */
export function resolveMyUserId(group: ExpenseGroup, email: string | null): string | null {
  if (!email) return null
  return group.members.find((m) => m.userEmail === email)?.userId ?? null
}

/** Default payer: the caller if identified, else the first member, else null. */
export function defaultPayerId(group: ExpenseGroup, myUserId: string | null): string | null {
  return myUserId ?? group.members[0]?.userId ?? null
}
