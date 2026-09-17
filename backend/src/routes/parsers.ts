import { Hono } from 'hono'
import { db } from '../db'
import { csvParsers } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { fail } from '../errors'

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
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { name, normalizedHeader, columnMapping } = body

  if (!name || typeof name !== 'string') return fail(c, 'FIELD_REQUIRED', { field: 'name' })
  if (!normalizedHeader || typeof normalizedHeader !== 'string') return fail(c, 'FIELD_REQUIRED', { field: 'normalizedHeader' })
  if (!columnMapping || typeof columnMapping !== 'object') return fail(c, 'FIELD_REQUIRED', { field: 'columnMapping' })
  if (!columnMapping.date || !columnMapping.amount) return fail(c, 'PARSER_MAPPING_INCOMPLETE')

  const defaultAccountId = body.defaultAccountId ?? null
  const isMultiCurrency = body.isMultiCurrency === true
  const defaultFeeAccountId = body.defaultFeeAccountId ?? null

  const [created] = await db
    .insert(csvParsers)
    .values({ userId, name, normalizedHeader, columnMapping, defaultAccountId, isMultiCurrency, defaultFeeAccountId })
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
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()

  const patch: Record<string, unknown> = {}

  if ('name' in body) {
    if (!body.name || typeof body.name !== 'string') return fail(c, 'FIELD_EMPTY', { field: 'name' })
    patch.name = body.name
  }

  if ('columnMapping' in body) {
    if (!body.columnMapping || typeof body.columnMapping !== 'object') return fail(c, 'FIELD_NOT_OBJECT', { field: 'columnMapping' })
    if (!body.columnMapping.date || !body.columnMapping.amount) return fail(c, 'PARSER_MAPPING_INCOMPLETE')
    patch.columnMapping = body.columnMapping
  }

  if ('defaultAccountId' in body) {
    if (body.defaultAccountId !== null && typeof body.defaultAccountId !== 'string') {
      return fail(c, 'FIELD_NOT_UUID', { field: 'defaultAccountId' })
    }
    patch.defaultAccountId = body.defaultAccountId
  }

  if ('isMultiCurrency' in body) {
    if (typeof body.isMultiCurrency !== 'boolean') return fail(c, 'FIELD_NOT_BOOLEAN', { field: 'isMultiCurrency' })
    patch.isMultiCurrency = body.isMultiCurrency
  }

  if ('defaultFeeAccountId' in body) {
    if (body.defaultFeeAccountId !== null && typeof body.defaultFeeAccountId !== 'string') {
      return fail(c, 'FIELD_NOT_UUID', { field: 'defaultFeeAccountId' })
    }
    patch.defaultFeeAccountId = body.defaultFeeAccountId
  }

  if (Object.keys(patch).length === 0) return fail(c, 'NO_FIELDS_TO_UPDATE')

  const [updated] = await db
    .update(csvParsers)
    .set(patch)
    .where(and(eq(csvParsers.id, c.req.param('id')), eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))
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
    .where(and(eq(csvParsers.id, c.req.param('id')), eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))
  return c.body(null, 204)
})

export default app
