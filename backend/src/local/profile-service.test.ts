import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { accounts, localProfile, user, userSettings } from '../db/schema'
import { clearDatabase } from '../test-utils'
import { ensureLocalProfile, LOCAL_EMAIL } from './profile-service'

beforeEach(async () => {
  await clearDatabase()
})

describe('the local profile', () => {
  it('is minted on the first run, with what a sign-up would have given it', async () => {
    const me = await ensureLocalProfile()

    expect(me.email).toBe(LOCAL_EMAIL)
    expect(me.emailVerified).toBe(false)
    const paths = await db
      .select({ path: accounts.path })
      .from(accounts)
      .where(eq(accounts.userId, me.id))
    expect(paths.map((a) => a.path).sort()).toEqual([
      'equity:adjustments',
      'equity:conversions',
      'expenses:uncategorized',
    ])
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, me.id))
    expect(settings?.defaultOffsetAccountId).toBeString()
    expect(settings?.defaultConversionAccountId).toBeString()
    expect(settings?.defaultAdjustmentsAccountId).toBeString()
  })

  it('is found, not minted again, on every run after', async () => {
    const first = await ensureLocalProfile()
    const second = await ensureLocalProfile()

    expect(second.id).toBe(first.id)
    expect(await db.select().from(user)).toHaveLength(1)
    expect(await db.select().from(accounts)).toHaveLength(3)
  })

  it('is one row at most, whatever writes to the table', async () => {
    const me = await ensureLocalProfile()
    const now = new Date()
    await db.insert(user).values({
      id: crypto.randomUUID(),
      name: 'Other',
      email: 'other@local.invalid',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    const [other] = await db.select().from(user).where(eq(user.email, 'other@local.invalid'))
    if (!other) throw new Error('insert user found nothing')

    // Same id: the primary key. Another id: the check.
    const insert = async (row: typeof localProfile.$inferInsert) => {
      await db.insert(localProfile).values(row)
    }
    await expect(insert({ userId: other.id })).rejects.toThrow()
    await expect(insert({ id: 'second', userId: other.id })).rejects.toThrow()
    expect((await ensureLocalProfile()).id).toBe(me.id)
  })
})
