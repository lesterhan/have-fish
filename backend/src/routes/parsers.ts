import { Hono } from 'hono'
import { db } from '../db'
import { csvParsers } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import type { AppVariables } from '../app'

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

  if (!name || typeof name !== 'string') return c.json({ error: 'name is required' }, 400)
  if (!normalizedHeader || typeof normalizedHeader !== 'string') return c.json({ error: 'normalizedHeader is required' }, 400)
  if (!columnMapping || typeof columnMapping !== 'object') return c.json({ error: 'columnMapping is required' }, 400)
  if (!columnMapping.date || !columnMapping.amount) return c.json({ error: 'columnMapping must include date and amount' }, 400)

  const defaultAccountId = body.defaultAccountId ?? null

  const [created] = await db
    .insert(csvParsers)
    .values({ userId, name, normalizedHeader, columnMapping, defaultAccountId })
    .returning()

  return c.json(created, 201)
})

// PATCH /api/parsers/:id
// Updates the defaultAccountId on an existing parser. Pass null to clear it.
// Only the fields listed here can be changed — column mapping stays immutable.
//
// Request body (JSON):
//   defaultAccountId — UUID of an account, or null to clear
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()

  if (!('defaultAccountId' in body)) return c.json({ error: 'defaultAccountId is required' }, 400)
  const { defaultAccountId } = body
  if (defaultAccountId !== null && typeof defaultAccountId !== 'string') {
    return c.json({ error: 'defaultAccountId must be a UUID string or null' }, 400)
  }

  const [updated] = await db
    .update(csvParsers)
    .set({ defaultAccountId })
    .where(and(eq(csvParsers.id, c.req.param('id')), eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))
    .returning()

  if (!updated) return c.json({ error: 'parser not found' }, 404)

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
