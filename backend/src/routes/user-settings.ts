import { Hono } from 'hono'
import { db } from '../db'
import { userSettings, accounts } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/user-settings
// Returns the current user's settings row. Creates one with null defaults if
// it doesn't exist yet (handles existing users who predate the seeding hook).
app.get('/', async (c) => {
  const userId = c.get('userId')

  let [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))

  if (!settings) {
    ;[settings] = await db
      .insert(userSettings)
      .values({ userId })
      .returning()
  }

  return c.json(settings)
})

// PATCH /api/user-settings
// Updates user settings fields. Unknown keys are ignored.
//
// Request body (JSON), all optional:
//   defaultOffsetAccountId     — UUID of an account owned by the user, or null
//   defaultConversionAccountId — UUID of an account owned by the user, or null
//   defaultAssetsRootPath      — plain text path prefix, e.g. "assets"
//   defaultLiabilitiesRootPath — plain text path prefix, e.g. "liabilities"
app.patch('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()

  const patch: Partial<typeof userSettings.$inferInsert> = {}

  // Account UUID fields — must reference an account owned by this user
  for (const field of ['defaultOffsetAccountId', 'defaultConversionAccountId'] as const) {
    if (!(field in body)) continue
    const value = body[field]

    if (value === null) {
      patch[field] = null
      continue
    }

    if (typeof value !== 'string') {
      return c.json({ error: `${field} must be a UUID string or null` }, 400)
    }

    // Verify the account exists and belongs to this user
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, value), eq(accounts.userId, userId), isNull(accounts.deletedAt)))

    if (!account) return c.json({ error: `account not found: ${field}` }, 400)

    patch[field] = value
  }

  // Plain text fields
  for (const field of ['defaultAssetsRootPath', 'defaultLiabilitiesRootPath', 'defaultExpensesRootPath'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (typeof value !== 'string' || !value.trim()) {
      return c.json({ error: `${field} must be a non-empty string` }, 400)
    }
    patch[field] = value.trim()
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'no valid fields to update' }, 400)
  }

  // Upsert: create the row if it doesn't exist, otherwise update it
  const [updated] = await db
    .insert(userSettings)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning()

  return c.json(updated)
})

export default app
