import { eq } from 'drizzle-orm'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { userSettings } from '../db/schema'
import { asPreferences, type Preferences } from './preferences'

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
 * That lock is the one Postgres-only step here; SQLite lets one writer in at a time and
 * needs nothing in its place.
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
    const [stored] = await tx
      .select({ preferences: userSettings.preferences })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .for('update')

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
