/**
 * Pure resolution helpers for the Add screen's payment row (payer chip + payment
 * account chip). RN-free so they unit-test under `bun test` — the API types are
 * imported type-only (erased at compile, so the RN-touching `api.ts` module is
 * never loaded at test runtime). Mirrors the `account-search.ts` / `group-entry.ts`
 * pattern: logic in lib, the `PaymentRow` component is a render shell.
 */

import type { ExpenseGroup } from './api'

/**
 * The payment account to seed when `payerId` is the payer — that member's
 * per-group `defaultPaymentAccountId`. Returns `''` (not null) when the member is
 * unknown or has no default configured, so it slots straight into the
 * AccountSelect's `selectedId: string` contract where `''` means "none".
 */
export function seedAccountForPayer(group: ExpenseGroup, payerId: string): string {
  return group.members.find((m) => m.userId === payerId)?.defaultPaymentAccountId ?? ''
}

/**
 * Whether tapping the payer chip should open a select sheet rather than flip
 * inline. True only for 3+ members; a 1- or 2-member group flips (or no-ops)
 * directly via {@link nextPayerOnTap}.
 */
export function shouldOpenPayerSheet(group: ExpenseGroup): boolean {
  return group.members.length > 2
}

/**
 * The payer a chip tap selects, for the inline fast path. For a 2-member group
 * returns the *other* member's id (instant flip). For 1 or 3+ members returns
 * `currentPayerId` unchanged — a solo group has nobody to flip to, and 3+ opens
 * a sheet (see {@link shouldOpenPayerSheet}) instead of flipping. Also unchanged
 * when `currentPayerId` isn't a member of the group (defensive).
 */
export function nextPayerOnTap(group: ExpenseGroup, currentPayerId: string): string {
  if (group.members.length !== 2) return currentPayerId
  // Only flip when the current payer is genuinely one of the two members;
  // otherwise there's no meaningful "other" to flip to.
  if (!group.members.some((m) => m.userId === currentPayerId)) return currentPayerId
  const other = group.members.find((m) => m.userId !== currentPayerId)
  return other?.userId ?? currentPayerId
}

/**
 * Decide the payment account after a payer change, applying the override rule:
 * a manual account pick (`userTouchedAccount`) wins and is preserved across payer
 * flips; otherwise the account re-seeds from the new payer's default. A no-op
 * payer change (same id) keeps the current account either way.
 *
 *   re-seed on payer change  ⇔  payer actually changed AND user hasn't overridden
 */
export function resolveAccountOnPayerChange(
  group: ExpenseGroup,
  prevPayerId: string,
  nextPayerId: string,
  userTouchedAccount: boolean,
  currentAccountId: string,
): string {
  if (userTouchedAccount) return currentAccountId
  if (prevPayerId === nextPayerId) return currentAccountId
  return seedAccountForPayer(group, nextPayerId)
}

/**
 * Compact label for the payment-account chip. Head-truncation keeps the leaf —
 * the identifying segment — and collapses any ancestors behind an ellipsis:
 * `liabilities:visa` → `…:visa`, a bare `cash` → `cash`. We never tail-truncate
 * (`liabilities:cre…`), since the leaf is what tells the accounts apart; the full
 * path is always available in the AccountSelect sheet. RN's `ellipsizeMode="head"`
 * on the chip is the pixel-level backstop for an over-long leaf.
 */
export function accountChipLabel(path: string): string {
  const segments = path
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return path
  const leaf = segments[segments.length - 1]
  return segments.length > 1 ? `…:${leaf}` : leaf
}
