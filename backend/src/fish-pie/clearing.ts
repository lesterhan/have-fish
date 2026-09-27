// A group's clearing account path: `assets:receivable:<slug of the group name>`, one per
// member per group. Pure; `fish-pie-accounts-service.ts` finds or creates the account.

import { CLEARING_PREFIX } from '../accounts/paths'

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function clearingAccountPath(name: string): string {
  return `${CLEARING_PREFIX}:${slugify(name)}`
}
