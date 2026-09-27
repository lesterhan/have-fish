// Reading and writing an account's catch-up config. The rules (inference, merging, what a
// pin may hold) are pure and live in `horizon.ts`; this loads their inputs and stores the pins.

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { accountCoverage, userSettings } from '../db/schema'
import { withCatchUpOverride } from '../settings/preferences'
import { writeSettings } from '../settings/settings-service'
import {
  type CoverageConfig,
  type CoverageConfigOverride,
  inferCycleFromIntervals,
  mergeConfig,
  overridesFrom,
} from './horizon'
import type { CoverageInterval } from './intervals'

// Every catchUp override for a user, keyed by account id. Read once per request rather than
// per account — the coach walks every tracked account and would otherwise issue N queries for
// one row of JSON.
export async function readCatchUpOverrides(
  userId: string,
): Promise<Record<string, CoverageConfigOverride>> {
  const [settings] = await db
    .select({ preferences: userSettings.preferences })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return overridesFrom(settings?.preferences)
}

// The live coverage assertions for one account, oldest first.
export async function readIntervals(
  userId: string,
  accountId: string,
): Promise<CoverageInterval[]> {
  return db
    .select({ fromDate: accountCoverage.fromDate, throughDate: accountCoverage.throughDate })
    .from(accountCoverage)
    .where(
      and(
        eq(accountCoverage.userId, userId),
        eq(accountCoverage.accountId, accountId),
        isNull(accountCoverage.deletedAt),
      ),
    )
}

// The config actually in force for one account, and the raw pins behind it.
//
// Both are needed by anything that lets the user edit the config: the merged config cannot say
// whether a value was inferred or pinned by hand, and "hand this field back to automatic" is
// only offerable when you know which it was. A field absent from `override` is inferred, and
// its inferred value is the one already sitting in `config`.
export async function resolveConfig(
  userId: string,
  accountId: string,
): Promise<{
  config: CoverageConfig
  override: CoverageConfigOverride
  inferred: CoverageConfigOverride | null
}> {
  const [intervals, overrides] = await Promise.all([
    readIntervals(userId, accountId),
    readCatchUpOverrides(userId),
  ])

  const override = overrides[accountId] ?? {}
  const inferred = inferCycleFromIntervals(intervals)
  return { config: mergeConfig(inferred, override), override, inferred }
}

// The config actually in force for one account: inference over its coverage history, with any
// user override laid on top.
export async function effectiveConfig(userId: string, accountId: string): Promise<CoverageConfig> {
  return (await resolveConfig(userId, accountId)).config
}

// Writes one account's overrides into preferences.catchUp without disturbing anything else in
// the blob: not the other accounts' overrides, and not the other features' keys.
export async function writeConfigOverride(
  userId: string,
  accountId: string,
  override: CoverageConfigOverride,
): Promise<void> {
  await writeSettings(userId, {}, (current) => withCatchUpOverride(current, accountId, override))
}
