import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { failWith } from '../respond'
import { readSettings, updateSettings } from '../settings/settings-service'
import { asField, defined, parseBody, text } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/user-settings
// Returns the current user's settings row. Creates one with null defaults if
// it doesn't exist yet (handles existing users who predate the seeding hook).
app.get('/', async (c) => c.json(await readSettings(c.get('userId'))))

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

// `updateSettings` holds the checks: each account default must be the caller's, the
// currency must be supported, and the change must name something.
app.patch('/', async (c) => {
  const parsed = await parseBody(c, SettingsPatch)
  if (!parsed.ok) return parsed.response
  const result = await updateSettings(c.get('userId'), defined(parsed.data))
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

export default app
