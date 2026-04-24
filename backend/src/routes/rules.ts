import { Hono } from 'hono'
import { db } from '../db'
import { importRules, accounts } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/rules
// Returns all non-deleted rules (active + suggested) for the current user.
// Joins accounts to include accountPath for display.
app.get('/', async (c) => {
  const userId = c.get('userId')

  // TODO: join accounts to include accountPath and accountName
  const rules = await db
    .select({
      id: importRules.id,
      pattern: importRules.pattern,
      accountId: importRules.accountId,
      accountPath: accounts.path,
      accountName: accounts.name,
      status: importRules.status,
      matchCount: importRules.matchCount,
      createdAt: importRules.createdAt,
      updatedAt: importRules.updatedAt,
    })
    .from(importRules)
    .innerJoin(accounts, eq(importRules.accountId, accounts.id))
    .where(and(eq(importRules.userId, userId), isNull(importRules.deletedAt)))

  return c.json(rules)
})

// POST /api/rules
// Creates a rule manually. status defaults to 'active'.
// Body: { pattern: string, accountId: string }
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { pattern, accountId } = body

  if (!pattern || typeof pattern !== 'string') return c.json({ error: 'pattern is required' }, 400)
  if (!accountId || typeof accountId !== 'string') return c.json({ error: 'accountId is required' }, 400)

  const [created] = await db
    .insert(importRules)
    .values({ userId, pattern, accountId, status: 'active' })
    .returning()

  return c.json(created, 201)
})

// PATCH /api/rules/:id
// Updates pattern and/or accountId. At least one field required.
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const patch: Record<string, unknown> = {}

  if ('pattern' in body) {
    if (!body.pattern || typeof body.pattern !== 'string') return c.json({ error: 'pattern must be a non-empty string' }, 400)
    patch.pattern = body.pattern
  }

  if ('accountId' in body) {
    if (!body.accountId || typeof body.accountId !== 'string') return c.json({ error: 'accountId must be a UUID string' }, 400)
    patch.accountId = body.accountId
  }

  if (Object.keys(patch).length === 0) return c.json({ error: 'at least one field is required' }, 400)

  patch.updatedAt = new Date()

  const [updated] = await db
    .update(importRules)
    .set(patch)
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
    .returning()

  if (!updated) return c.json({ error: 'rule not found' }, 404)
  return c.json(updated)
})

// DELETE /api/rules/:id
// Soft-deletes a rule.
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  await db
    .update(importRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
  return c.body(null, 204)
})

// POST /api/rules/:id/approve
// Flips a suggested rule to active.
app.post('/:id/approve', async (c) => {
  const userId = c.get('userId')

  const [updated] = await db
    .update(importRules)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
    .returning()

  if (!updated) return c.json({ error: 'rule not found' }, 404)
  return c.json(updated)
})

// POST /api/rules/:id/deny
// Soft-deletes a suggested rule (semantically distinct from DELETE).
app.post('/:id/deny', async (c) => {
  const userId = c.get('userId')
  await db
    .update(importRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
  return c.body(null, 204)
})

export default app
