import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { db } from '../db'
import { csvParsers } from '../db/schema'
import { fail } from '../errors'
import { as, asField, parseBody, text } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/parsers
// Returns all active (non-deleted) parsers belonging to the current user.
app.get('/', async (c) => {
  const userId = c.get('userId')
  const all = await db
    .select()
    .from(csvParsers)
    .where(and(eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))
  return c.json(all)
})

// POST /api/parsers
// Creates a new parser config for the current user.
//
// Request body (JSON):
//   name             — human-readable name, e.g. "Big Bank Chequing"
//   normalizedHeader — pipe-joined sorted normalized column names (fingerprint)
//   columnMapping    — { date: string, amount: string, description?: string, currency?: string }
// A mapping names which CSV column holds what. `date` and `amount` are the two the
// importer cannot work without; the rest are optional and the mapping stays open, because
// a parser built for an unusual export carries columns this schema has never heard of.
//
// `notAnObject` is a parameter because the two routes disagree about it: creating a parser
// without a mapping has always been `FIELD_REQUIRED`, patching one with a non-object has
// always been `FIELD_NOT_OBJECT`. Both are kept.
function columnMapping(notAnObject: ReturnType<typeof asField>) {
  const incomplete = as('PARSER_MAPPING_INCOMPLETE')
  return z.looseObject(
    {
      date: z.string({ error: incomplete }).min(1, { error: incomplete }),
      amount: z.string({ error: incomplete }).min(1, { error: incomplete }),
    },
    { error: notAnObject },
  )
}

const CreateParser = z.object({
  name: text('FIELD_REQUIRED'),
  normalizedHeader: text('FIELD_REQUIRED'),
  columnMapping: columnMapping(asField('FIELD_REQUIRED')),
  defaultAccountId: z.uuid({ error: asField('FIELD_NOT_UUID') }).nullish(),
  isMultiCurrency: z.boolean({ error: asField('FIELD_NOT_BOOLEAN') }).optional(),
  defaultFeeAccountId: z.uuid({ error: asField('FIELD_NOT_UUID') }).nullish(),
})

app.post('/', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, CreateParser)
  if (!parsed.ok) return parsed.response
  const { name, normalizedHeader, columnMapping } = parsed.data

  const defaultAccountId = parsed.data.defaultAccountId ?? null
  const isMultiCurrency = parsed.data.isMultiCurrency === true
  const defaultFeeAccountId = parsed.data.defaultFeeAccountId ?? null

  const [created] = await db
    .insert(csvParsers)
    .values({
      userId,
      name,
      normalizedHeader,
      columnMapping,
      defaultAccountId,
      isMultiCurrency,
      defaultFeeAccountId,
    })
    .returning()

  return c.json(created, 201)
})

// PATCH /api/parsers/:id
// Updates one or more mutable fields on an existing parser. At least one field required.
//
// Request body (JSON, all optional but at least one required):
//   name                — human-readable parser name
//   columnMapping       — full column mapping object (date and amount required if present)
//   defaultAccountId    — UUID of an account, or null to clear
//   isMultiCurrency     — boolean
//   defaultFeeAccountId — UUID of an account, or null to clear
const ParserPatch = z.object({
  name: text('FIELD_EMPTY').optional(),
  columnMapping: columnMapping(asField('FIELD_NOT_OBJECT')).optional(),
  defaultAccountId: z
    .uuid({ error: asField('FIELD_NOT_UUID') })
    .nullable()
    .optional(),
  isMultiCurrency: z.boolean({ error: asField('FIELD_NOT_BOOLEAN') }).optional(),
  defaultFeeAccountId: z
    .uuid({ error: asField('FIELD_NOT_UUID') })
    .nullable()
    .optional(),
})

app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, ParserPatch)
  if (!parsed.ok) return parsed.response

  // `parsed.data` already holds exactly the keys the request sent, each one checked, so
  // the patch is what it parsed rather than a field-by-field copy.
  const patch: Record<string, unknown> = parsed.data
  if (Object.keys(patch).length === 0) return fail(c, 'NO_FIELDS_TO_UPDATE')

  const [updated] = await db
    .update(csvParsers)
    .set(patch)
    .where(
      and(
        eq(csvParsers.id, c.req.param('id')),
        eq(csvParsers.userId, userId),
        isNull(csvParsers.deletedAt),
      ),
    )
    .returning()

  if (!updated) return fail(c, 'PARSER_NOT_FOUND')

  return c.json(updated)
})

// DELETE /api/parsers/:id
// Soft-deletes a parser. Only affects parsers owned by the current user.
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  await db
    .update(csvParsers)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(csvParsers.id, c.req.param('id')),
        eq(csvParsers.userId, userId),
        isNull(csvParsers.deletedAt),
      ),
    )
  return c.body(null, 204)
})

export default app
