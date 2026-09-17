/**
 * Which accounts the rest of the app is pointing at, and what that means for curating them.
 *
 * Three settings hold an account id — the offset account imports post uncategorized rows to,
 * the conversion account cross-currency transactions clear through, and the adjustments
 * account reconciliation writes to. Those are pointers, and nothing has ever checked them
 * before letting you remove their target: the Settings panel will happily delete your default
 * offset account and leave `defaultOffsetAccountId` aimed at a soft-deleted row, which breaks
 * every import that leans on it, silently, at the next upload.
 *
 * `assets:receivable:*` is the other untouchable set: Fish Pie re-creates those rows on import,
 * so removing one is at best a no-op and at worst confusing.
 */

import type { UserSettings } from '../../api'
// Relative, not `$lib`: this module is unit-tested directly. See lib-imports.test.ts.
import { accountsCopy } from '../../copy/accounts'
import { RECEIVABLE_SEGMENT, isUnderRoot, type Roots } from './accountPaths'

export type AccountRole = 'offset' | 'conversion' | 'adjustments'

/** Short, uppercase, for a chip on the row. */
export const ROLE_LABEL: Record<AccountRole, string> = accountsCopy.flags.roles

/** What breaks if the pointer is left dangling — the tooltip on the chip. */
export const ROLE_DESCRIPTION: Record<AccountRole, string> =
  accountsCopy.flags.roleHints

/** Every role this account currently fills, in a stable order. */
export function rolesOf(
  accountId: string,
  settings: UserSettings | null | undefined,
): AccountRole[] {
  if (!settings) return []
  const roles: AccountRole[] = []
  if (settings.defaultOffsetAccountId === accountId) roles.push('offset')
  if (settings.defaultConversionAccountId === accountId)
    roles.push('conversion')
  if (settings.defaultAdjustmentsAccountId === accountId)
    roles.push('adjustments')
  return roles
}

/** True for the system-managed receivable subtree, which Fish Pie owns. */
export function isSystemManaged(path: string, roots: Roots): boolean {
  return isUnderRoot(path, `${roots.assets}:${RECEIVABLE_SEGMENT}`)
}

/**
 * Why an account cannot be hidden or deleted, or null when it can be.
 *
 * Returned as a reason rather than a boolean because the UI has to *say* which it is: "this is
 * your offset account" and "Fish Pie manages this" call for different fixes, and a disabled
 * control with no explanation is the thing that makes people click it repeatedly.
 */
export type Protection =
  { kind: 'role'; roles: AccountRole[] } | { kind: 'system' }

export function protectionFor(
  account: { id: string; path: string },
  settings: UserSettings | null | undefined,
  roots: Roots,
): Protection | null {
  const roles = rolesOf(account.id, settings)
  if (roles.length > 0) return { kind: 'role', roles }
  if (isSystemManaged(account.path, roots)) return { kind: 'system' }
  return null
}

/** One sentence naming the blocker and the way out of it. */
export function protectionMessage(protection: Protection): string {
  if (protection.kind === 'system') return accountsCopy.flags.systemManaged
  // The roles are joined here and the sentence chosen there: the old version inflected
  // "this is"/"these are" mid-sentence, which is a splice wearing whole words.
  const names = protection.roles.map((r) => ROLE_LABEL[r]).join(', ')
  return accountsCopy.flags.rolesInUse(names, protection.roles.length)
}
