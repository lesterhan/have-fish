import { eq } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { isValidCurrency } from '../currencies'
import { db, forUpdate } from '../db'
import { returnedRow } from '../db/returning'
import { userSettings } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import { asPreferences, mergePreferences, type Preferences } from './preferences'

/** The settings columns a caller may set directly. `preferences` is changed through a function. */
export type SettingsColumns = Omit<
  Partial<typeof userSettings.$inferInsert>,
  'userId' | 'preferences'
>

/**
 * Write the caller's settings row, creating it first if they have none (users who predate
 * the sign-up hook), and return it.
 *
 * `changePreferences`, when given, receives the stored blob and returns the whole new one
 * (`preferences.ts` has the changes). The row is locked from that read to the write, so two
 * requests changing different keys at once both land rather than one overwriting the other.
 * `forUpdate` is that lock on Postgres and nothing on SQLite, whose transaction already holds
 * the database's one write lock.
 */
export async function writeSettings(
  userId: string,
  columns: SettingsColumns,
  changePreferences?: (current: Preferences) => Preferences,
) {
  return db.transaction(async (tx) => {
    await tx.insert(userSettings).values({ userId }).onConflictDoNothing({
      target: userSettings.userId,
    })
    const [stored] = await forUpdate(
      tx
        .select({ preferences: userSettings.preferences })
        .from(userSettings)
        .where(eq(userSettings.userId, userId)),
    )

    const preferences = changePreferences?.(asPreferences(stored?.preferences))
    return returnedRow(
      await tx
        .update(userSettings)
        .set({ ...columns, ...(preferences ? { preferences } : {}) })
        .where(eq(userSettings.userId, userId))
        .returning(),
      'update user_settings',
    )
  })
}

type SettingsRow = typeof userSettings.$inferSelect

/**
 * The caller's settings row, created with null defaults if they have none yet (users who
 * predate the sign-up hook).
 */
export async function readSettings(userId: string): Promise<SettingsRow> {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  if (settings) return settings
  return returnedRow(
    await db.insert(userSettings).values({ userId }).returning(),
    'insert user_settings',
  )
}

// The three settings that point at an account. Each must be one of the caller's active
// accounts, since imports write postings to it.
const ACCOUNT_SETTINGS = [
  'defaultOffsetAccountId',
  'defaultConversionAccountId',
  'defaultAdjustmentsAccountId',
] as const

/** A change to the settings, as a request names it. Null clears an account default. */
export type SettingsChange = { [K in (typeof ACCOUNT_SETTINGS)[number]]?: string | null } & {
  defaultAssetsRootPath?: string
  defaultLiabilitiesRootPath?: string
  defaultExpensesRootPath?: string
  defaultEquityRootPath?: string
  defaultIncomeRootPath?: string
  preferredCurrency?: string
  /** Shallow-merged into what is stored, so patching one key never wipes the others. */
  preferences?: Preferences
}

/**
 * Apply a change to the caller's settings and return the row.
 *
 * Refused, in this order: an account default that isn't the caller's active account (the
 * first such field is named), an unsupported preferred currency, and a change that names
 * nothing. The currency is stored upper-case.
 */
export async function updateSettings(
  userId: string,
  change: SettingsChange,
): Promise<Outcome<SettingsRow>> {
  const { preferences, preferredCurrency, ...columns } = change
  const patch: SettingsColumns = { ...columns }

  for (const field of ACCOUNT_SETTINGS) {
    const id = change[field]
    if (id && !(await accountsOwnedBy(userId, [id]))) {
      return { ok: false, failure: errorBody('SETTING_ACCOUNT_NOT_FOUND', { field }) }
    }
  }

  if (preferredCurrency !== undefined) {
    if (!isValidCurrency(preferredCurrency)) {
      return {
        ok: false,
        failure: errorBody('UNSUPPORTED_CURRENCY', { currency: preferredCurrency }),
      }
    }
    patch.preferredCurrency = preferredCurrency.toUpperCase()
  }

  if (Object.keys(patch).length === 0 && preferences === undefined) {
    return { ok: false, failure: errorBody('NO_FIELDS_TO_UPDATE') }
  }

  const updated = await writeSettings(
    userId,
    patch,
    preferences && ((current) => mergePreferences(current, preferences)),
  )
  return { ok: true, value: updated }
}
