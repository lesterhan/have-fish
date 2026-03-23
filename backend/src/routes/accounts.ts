import { Hono } from 'hono'
import { db } from '../db'
import { accounts, postings, userSettings } from '../db/schema'
import { eq, isNull, and, like, sql } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

app.get('/', async (c) => {
  const userId = c.get('userId')
  const all = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  return c.json(all)
})

// GET /api/accounts/balances
// Returns all asset accounts with their per-currency balances.
// "Asset accounts" = accounts whose path starts with the user's defaultAssetsRootPath.
// Balance = SUM of all posting amounts for that account, grouped by currency.
// Accounts with no postings are included with an empty balances array.
app.get('/balances', async (c) => {
  const userId = c.get('userId')

  // Look up the user's configured assets root path, fall back to 'assets'
  const [settings] = await db
    .select({ defaultAssetsRootPath: userSettings.defaultAssetsRootPath })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  const root = settings?.defaultAssetsRootPath ?? 'assets'

  // LEFT JOIN so accounts with no postings still appear (with null currency/balance)
  const rows = await db
    .select({
      id: accounts.id,
      path: accounts.path,
      currency: postings.currency,
      balance: sql<string>`SUM(${postings.amount})`,
    })
    .from(accounts)
    .leftJoin(postings, eq(postings.accountId, accounts.id))
    .where(and(
      eq(accounts.userId, userId),
      isNull(accounts.deletedAt),
      like(accounts.path, `${root}:%`),
    ))
    .groupBy(accounts.id, accounts.path, postings.currency)

  // Collapse the flat rows into one entry per account with a balances array
  const grouped = new Map<string, { id: string; path: string; balances: { currency: string; amount: string }[] }>()
  for (const row of rows) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id, { id: row.id, path: row.path, balances: [] })
    }
    if (row.currency !== null && row.balance !== null) {
      grouped.get(row.id)!.balances.push({ currency: row.currency, amount: row.balance })
    }
  }

  return c.json([...grouped.values()])
})

app.get('/:id', async (c) => {
  const userId = c.get('userId')
  const [found] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, c.req.param('id')), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!found) return c.json({ error: 'Not found' }, 404)
  return c.json(found)
})

app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  // userId from session overrides anything the client may have sent
  const [created] = await db.insert(accounts).values({ ...body, userId }).returning()
  return c.json(created, 201)
})

app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  await db
    .update(accounts)
    .set({ deletedAt: new Date() })
    .where(and(eq(accounts.id, c.req.param('id')), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  return c.body(null, 204)
})

export default app
