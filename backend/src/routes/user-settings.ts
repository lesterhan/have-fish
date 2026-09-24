import { and, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { db } from '../db'
import { accounts, userSettings } from '../db/schema'
import { fail } from '../errors'
import { asField, parseBody, text } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/user-settings
// Returns the current user's settings row. Creates one with null defaults if
// it doesn't exist yet (handles existing users who predate the seeding hook).
app.get('/', async (c) => {
  const userId = c.get('userId')

  let [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))

  if (!settings) {
    ;[settings] = await db.insert(userSettings).values({ userId }).returning()
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
//   defaultExpensesRootPath    — plain text path prefix, e.g. "expenses"
//   defaultEquityRootPath      — plain text path prefix, e.g. "equity"
//   defaultIncomeRootPath      — plain text path prefix, e.g. "income"
//   preferences                — arbitrary JSON object, shallow-merged into existing preferences
// Every field is optional — a patch names only what it changes — and the three account
// fields are additionally nullable, because null is how a default is cleared.
//
// `z.uuid()` on the account ids is a tightening: they used to be checked only for being a
// string and then handed to a uuid column, so `"abc"` reached Postgres and came back as a
// 500 rather than as the `FIELD_NOT_UUID` the route already had a name for.
const SettingsPatch = z.object({
  defaultOffsetAccountId: z
    .uuid({ error: asField('FIELD_NOT_UUID') })
    .nullable()
    .optional(),
  defaultConversionAccountId: z
    .uuid({ error: asField('FIELD_NOT_UUID') })
    .nullable()
    .optional(),
  defaultAdjustmentsAccountId: z
    .uuid({ error: asField('FIELD_NOT_UUID') })
    .nullable()
    .optional(),

  defaultAssetsRootPath: text('FIELD_EMPTY').optional(),
  defaultLiabilitiesRootPath: text('FIELD_EMPTY').optional(),
  defaultExpensesRootPath: text('FIELD_EMPTY').optional(),
  defaultEquityRootPath: text('FIELD_EMPTY').optional(),
  defaultIncomeRootPath: text('FIELD_EMPTY').optional(),

  preferredCurrency: text('FIELD_EMPTY').optional(),

  // Arbitrary keys, shallow-merged below. The schema's job here is only to refuse an
  // array, a null or a scalar, which is what the hand-written check did.
  preferences: z.record(z.string(), z.unknown(), { error: asField('FIELD_NOT_OBJECT') }).optional(),
})

app.patch('/', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, SettingsPatch)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const patch: Partial<typeof userSettings.$inferInsert> = {}

  // Account UUID fields — must reference an account owned by this user
  for (const field of [
    'defaultOffsetAccountId',
    'defaultConversionAccountId',
    'defaultAdjustmentsAccountId',
  ] as const) {
    const value = body[field]
    if (value === undefined) continue

    if (value === null) {
      patch[field] = null
      continue
    }

    // Verify the account exists and belongs to this user
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, value), eq(accounts.userId, userId), isNull(accounts.deletedAt)))

    if (!account) return fail(c, 'SETTING_ACCOUNT_NOT_FOUND', { field })

    patch[field] = value
  }

  // Plain text fields
  for (const field of [
    'defaultAssetsRootPath',
    'defaultLiabilitiesRootPath',
    'defaultExpensesRootPath',
    'defaultEquityRootPath',
    'defaultIncomeRootPath',
  ] as const) {
    const value = body[field]
    if (value === undefined) continue
    patch[field] = value
  }

  // preferredCurrency — validated against the supported currency list
  if (body.preferredCurrency !== undefined) {
    if (!isValidCurrency(body.preferredCurrency)) {
      return fail(c, 'UNSUPPORTED_CURRENCY', { currency: body.preferredCurrency })
    }
    patch.preferredCurrency = body.preferredCurrency.toUpperCase()
  }

  // preferences — shallow-merged into existing JSONB using the || operator so
  // patching one key never wipes unrelated keys set by other features.
  let preferencePatch: ReturnType<typeof sql> | undefined
  if (body.preferences !== undefined) {
    preferencePatch = sql`COALESCE(${userSettings.preferences}, '{}') || ${JSON.stringify(body.preferences)}::jsonb`
  }

  if (Object.keys(patch).length === 0 && !preferencePatch) {
    return fail(c, 'NO_FIELDS_TO_UPDATE')
  }

  // Upsert: create the row if it doesn't exist, otherwise update it
  const [updated] = await db
    .insert(userSettings)
    .values({ userId, ...patch, preferences: body.preferences ?? {} })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        ...patch,
        ...(preferencePatch ? { preferences: preferencePatch } : {}),
        updatedAt: new Date(),
      },
    })
    .returning()

  return c.json(updated)
})

export default app
