import { Hono } from 'hono'
import { db } from '../db'
import { accounts, postings, userSettings } from '../db/schema'
import { eq, isNull, and, like, or, sql } from 'drizzle-orm'
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
// Returns all asset and liability accounts with their per-currency balances and type.
// "Asset accounts"     = paths starting with defaultAssetsRootPath
// "Liability accounts" = paths starting with defaultLiabilitiesRootPath
// Balance = SUM of all posting amounts for that account, grouped by currency.
// Accounts with no postings are included with an empty balances array.
app.get('/balances', async (c) => {
  const userId = c.get('userId')

  const [settings] = await db
    .select({
      defaultAssetsRootPath: userSettings.defaultAssetsRootPath,
      defaultLiabilitiesRootPath: userSettings.defaultLiabilitiesRootPath,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  const assetsRoot = settings?.defaultAssetsRootPath ?? 'assets'
  const liabilitiesRoot = settings?.defaultLiabilitiesRootPath ?? 'liabilities'

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
      or(
        like(accounts.path, `${assetsRoot}:%`),
        like(accounts.path, `${liabilitiesRoot}:%`),
      ),
    ))
    .groupBy(accounts.id, accounts.path, postings.currency)

  // Collapse the flat rows into one entry per account with a balances array
  type AccountType = 'asset' | 'liability'
  const grouped = new Map<string, { id: string; path: string; type: AccountType; balances: { currency: string; amount: string }[] }>()
  for (const row of rows) {
    if (!grouped.has(row.id)) {
      const type: AccountType = row.path.startsWith(`${assetsRoot}:`) ? 'asset' : 'liability'
      grouped.set(row.id, { id: row.id, path: row.path, type, balances: [] })
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
