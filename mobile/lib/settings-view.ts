/**
 * Pure, RN-free view model for the group Settings screen.
 *
 * Shapes an `ExpenseGroup` (+ the user's accounts) into the rows the screen
 * renders: the group summary, the baseline split, the category→account list, and
 * the per-category weight editor's starting state. Kept free of any React Native
 * import so `bun test` can cover the logic without a renderer (Companion
 * convention — components render from these helpers).
 *
 * Weights are positive integers; a member's share is its weight over the vector
 * sum, rounded to a whole percent for display only (the real split is computed
 * server-side from the integer weights).
 */
import type { Account, ExpenseGroup, GroupCategory, GroupMember } from './api'

export interface GroupCard {
  name: string
  currency: string
  memberCount: number
}

export interface WeightRow {
  userId: string
  name: string
  weight: number
  /** Whole-percent share of the weight sum, for the faint `{pct}%` display. */
  percent: number
}

export interface AccountRow {
  categoryId: string
  name: string
  /** Resolved ledger path, or null when no mapping / the account is missing. */
  accountPath: string | null
}

/** Top summary card — name, default currency, member count. */
export function groupCard(group: ExpenseGroup): GroupCard {
  return {
    name: group.name,
    currency: group.defaultCurrency ?? '—',
    memberCount: group.members.length,
  }
}

/** Whole-percent share of `weight` within `total` (0 when total is non-positive). */
export function percent(weight: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((weight / total) * 100)
}

/** Attach a `percent` to each row from the summed weights. */
function withPercents(rows: { userId: string; name: string; weight: number }[]): WeightRow[] {
  const total = rows.reduce((sum, r) => sum + r.weight, 0)
  return rows.map((r) => ({ ...r, percent: percent(r.weight, total) }))
}

/** Active (non-archived) categories in their configured order. */
export function activeCategories(categories: GroupCategory[]): GroupCategory[] {
  return categories
    .filter((c) => c.archivedAt == null)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Baseline split — each member's group-level `shareWeight` as a percent row. */
export function splitRows(members: GroupMember[]): WeightRow[] {
  return withPercents(
    members.map((m) => ({ userId: m.userId, name: m.userName, weight: m.shareWeight })),
  )
}

/** Category → resolved posting-account path (read-only; web-managed). */
export function accountRows(categories: GroupCategory[], accounts: Account[]): AccountRow[] {
  const pathById = new Map(accounts.map((a) => [a.id, a.path]))
  return activeCategories(categories).map((c) => ({
    categoryId: c.id,
    name: c.name,
    accountPath: c.myMapping ? pathById.get(c.myMapping.accountId) ?? null : null,
  }))
}

/**
 * True when a category carries a complete per-member override (every current
 * member has a weight). A partial or empty vector means the split falls back to
 * the group baseline, so it does not count as an override.
 */
export function categoryHasOverride(category: GroupCategory, members: GroupMember[]): boolean {
  if (members.length === 0 || category.weights.length === 0) return false
  const ids = new Set(category.weights.map((w) => w.userId))
  return members.every((m) => ids.has(m.userId))
}

/**
 * Starting rows for a category's weight editor. When the category has a complete
 * override those weights are used; otherwise it inherits the baseline
 * `shareWeight` (see {@link inheritsBaseline} to show the inherited badge).
 */
export function categoryWeightRows(category: GroupCategory, members: GroupMember[]): WeightRow[] {
  const override = categoryHasOverride(category, members)
  const byUser = new Map(category.weights.map((w) => [w.userId, w.weight]))
  return withPercents(
    members.map((m) => ({
      userId: m.userId,
      name: m.userName,
      weight: override ? byUser.get(m.userId) ?? m.shareWeight : m.shareWeight,
    })),
  )
}

/** Inverse of {@link categoryHasOverride} — the editor opens showing baseline. */
export function inheritsBaseline(category: GroupCategory, members: GroupMember[]): boolean {
  return !categoryHasOverride(category, members)
}

/** Member weight vector — what the editor saves and the API expects. */
export type WeightVector = { userId: string; weight: number }[]

/** Baseline vector straight from the members' group-level `shareWeight`. */
export function baselineVector(members: GroupMember[]): WeightVector {
  return members.map((m) => ({ userId: m.userId, weight: m.shareWeight }))
}

/** Per-category seed vector (override when complete, else inherited baseline). */
export function categoryVector(category: GroupCategory, members: GroupMember[]): WeightVector {
  return categoryWeightRows(category, members).map((r) => ({ userId: r.userId, weight: r.weight }))
}

/**
 * The first member's percentage of a two-member split — the value the slider
 * binds to. Null when the vector doesn't cover both members or sums to zero
 * (the caller then falls back to 50). Mirrors the web `weightsToPct`.
 */
export function weightsToPct(weights: WeightVector, member0Id: string, member1Id: string): number | null {
  const w0 = weights.find((w) => w.userId === member0Id)?.weight
  const w1 = weights.find((w) => w.userId === member1Id)?.weight
  if (w0 === undefined || w1 === undefined) return null
  const total = w0 + w1
  if (total <= 0) return null
  return Math.round((w0 / total) * 100)
}

/**
 * Build a complete two-member vector from the first member's slider percentage,
 * clamping each side to at least 1 so neither member gets a zero weight. Mirrors
 * the web `pctToVector`.
 */
export function pctToVector(pct: number, member0Id: string, member1Id: string): WeightVector {
  const w0 = Math.min(99, Math.max(1, Math.round(pct)))
  return [
    { userId: member0Id, weight: w0 },
    { userId: member1Id, weight: 100 - w0 },
  ]
}

/** One-line `Ada 60% · Bo 40%` summary for a split row's value. */
export function splitSummary(rows: WeightRow[]): string {
  return rows.map((r) => `${r.name} ${r.percent}%`).join(' · ')
}

/** Compact `60/40` percent label for a tight row (no member names). */
export function splitShort(rows: WeightRow[]): string {
  return rows.map((r) => r.percent).join('/')
}
