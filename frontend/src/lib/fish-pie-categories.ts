// Pure helpers for the fish-pie category management UI. Kept framework-free so they
// can be unit-tested without a component harness (see fish-pie-categories.test.ts).

import type { Account, GroupCategory } from './api'

// The leaf segment of a colon-delimited account path: "expenses:food:dining" -> "dining".
export function leafName(path: string): string {
  const parts = path.split(':')
  return parts[parts.length - 1] ?? path
}

// Auto-suggest an account for a category by matching the category name (case-insensitive)
// against each account's leaf name. Returns the first matching account id, or null. Used
// to pre-fill the mapping input on a category the member hasn't mapped yet.
export function suggestAccountId(categoryName: string, accounts: Account[]): string | null {
  const target = categoryName.trim().toLowerCase()
  if (!target) return null
  const match = accounts.find((a) => leafName(a.path).toLowerCase() === target)
  return match?.id ?? null
}

// Convert a category's shared weight vector into the slider percentage for the FIRST
// member, for the two-member case. Returns null when the vector is empty or doesn't
// cover both members (the split then falls back to the group default, shown as 50/50).
export function weightsToPct(
  weights: GroupCategory['weights'],
  member0Id: string,
  member1Id: string,
): number | null {
  const w0 = weights.find((w) => w.userId === member0Id)?.weight
  const w1 = weights.find((w) => w.userId === member1Id)?.weight
  if (w0 === undefined || w1 === undefined) return null
  const total = w0 + w1
  if (total <= 0) return null
  return Math.round((w0 / total) * 100)
}

// Build a complete two-member weight vector from the first member's slider percentage.
// Clamps each side to at least 1 so neither member gets a zero weight.
export function pctToVector(
  pct: number,
  member0Id: string,
  member1Id: string,
): { userId: string; weight: number }[] {
  const w0 = Math.min(99, Math.max(1, Math.round(pct)))
  const w1 = 100 - w0
  return [
    { userId: member0Id, weight: w0 },
    { userId: member1Id, weight: w1 },
  ]
}
