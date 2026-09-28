// The one person a local build serves (#287). There is no sign-in: the first run inserts a
// `user` row directly, gives it what a sign-up would have, and records it in `local_profile`.
// Every later run finds it there. Nothing here runs in the server build.

import { eq } from 'drizzle-orm'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { localProfile, user } from '../db/schema'
import { giveStarterSet } from '../users/starter-service'

/**
 * A placeholder, never an address anyone reads: the column is required and unique, and the
 * `.invalid` top-level domain is reserved for exactly this (RFC 2606). Identity arrives only
 * when the user links to a sync service.
 */
export const LOCAL_EMAIL = 'me@local.invalid'

export type LocalUser = typeof user.$inferSelect

/** The local profile's user, minted on the first run and found on every run after. */
export async function ensureLocalProfile(): Promise<LocalUser> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ user })
      .from(localProfile)
      .innerJoin(user, eq(user.id, localProfile.userId))
      .limit(1)
    if (profile) return profile.user

    const now = new Date()
    const minted = returnedRow(
      await tx
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: 'Me',
          email: LOCAL_EMAIL,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      'insert user',
    )
    await giveStarterSet(tx, minted.id)
    await tx.insert(localProfile).values({ userId: minted.id })
    return minted
  })
}
