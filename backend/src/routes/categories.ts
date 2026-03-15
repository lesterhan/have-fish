import { Hono } from 'hono'
import { db } from '../db'
import { categories } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

app.get('/', async (c) => {
  const userId = c.get('userId')
  const all = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.deletedAt)))
  return c.json(all)
})

app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  // userId from session overrides anything the client may have sent
  const [created] = await db.insert(categories).values({ ...body, userId }).returning()
  return c.json(created, 201)
})

app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  await db
    .update(categories)
    .set({ deletedAt: new Date() })
    .where(and(eq(categories.id, c.req.param('id')), eq(categories.userId, userId), isNull(categories.deletedAt)))
  return c.body(null, 204)
})

export default app
