import { Hono } from 'hono'
import { db } from '../db'
import { transactions } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'

const app = new Hono()

app.get('/', async (c) => {
  const accountId = c.req.query('accountId')
  const all = accountId
    ? await db.select().from(transactions).where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt)))
    : await db.select().from(transactions).where(isNull(transactions.deletedAt))
  return c.json(all)
})

app.post('/', async (c) => {
  const body = await c.req.json()
  const [created] = await db.insert(transactions).values(body).returning()
  return c.json(created, 201)
})

app.delete('/:id', async (c) => {
  await db
    .update(transactions)
    .set({ deletedAt: new Date() })
    .where(and(eq(transactions.id, c.req.param('id')), isNull(transactions.deletedAt)))
  return c.body(null, 204)
})

export default app
