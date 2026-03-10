import { Hono } from 'hono'
import { db } from '../db'
import { accounts } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'

const app = new Hono()

app.get('/', async (c) => {
  const all = await db.select().from(accounts).where(isNull(accounts.deletedAt))
  return c.json(all)
})

app.get('/:id', async (c) => {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, c.req.param('id')), isNull(accounts.deletedAt)))
  if (!account) return c.json({ error: 'Not found' }, 404)
  return c.json(account)
})

app.post('/', async (c) => {
  const body = await c.req.json()
  const [created] = await db.insert(accounts).values(body).returning()
  return c.json(created, 201)
})

app.delete('/:id', async (c) => {
  await db
    .update(accounts)
    .set({ deletedAt: new Date() })
    .where(and(eq(accounts.id, c.req.param('id')), isNull(accounts.deletedAt)))
  return c.body(null, 204)
})

export default app
