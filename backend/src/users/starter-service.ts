// What every new user starts with, however they arrive: the three accounts the ledger posts to
// by default, and a settings row pointing at them. The server build's sign-up hook (`auth.ts`)
// and the local build's first run (`local/profile-service.ts`) both come through here, so a
// user made either way can import, convert and reconcile from the first minute.

import { pathKey } from '../accounts/paths'
import type { Executor } from '../db'
import { accounts, userSettings } from '../db/schema'

export async function giveStarterSet(executor: Executor, userId: string): Promise<void> {
  const [offsetAccount, conversionAccount, adjustmentsAccount] = await executor
    .insert(accounts)
    .values(
      ['expenses:uncategorized', 'equity:conversions', 'equity:adjustments'].map((path) => ({
        userId,
        path,
        pathKey: pathKey(path),
      })),
    )
    .returning()

  // Three values in, three rows back. If that ever stops holding, a new account would
  // silently get a settings row pointing at nothing, so say so loudly here instead.
  if (!offsetAccount || !conversionAccount || !adjustmentsAccount) {
    throw new Error('insert accounts returned fewer rows than it was given')
  }

  await executor.insert(userSettings).values({
    userId,
    defaultOffsetAccountId: offsetAccount.id,
    defaultConversionAccountId: conversionAccount.id,
    defaultAdjustmentsAccountId: adjustmentsAccount.id,
  })
}
