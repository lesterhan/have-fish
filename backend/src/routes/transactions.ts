import { Hono } from 'hono'
import { db } from '../db'
import { transactions } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

app.get('/', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.query('accountId')
  const all = accountId
    ? await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId), isNull(transactions.deletedAt)))
    : await db.select().from(transactions).where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
  return c.json(all)
})

app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const [created] = await db.insert(transactions).values({ ...body, userId }).returning()
  return c.json(created, 201)
})

app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  await db
    .update(transactions)
    .set({ deletedAt: new Date() })
    .where(and(eq(transactions.id, c.req.param('id')), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
  return c.body(null, 204)
})

export default app
