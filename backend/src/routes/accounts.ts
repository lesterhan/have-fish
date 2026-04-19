import { Hono } from 'hono'
import { db } from '../db'
import { accounts, postings, transactions, userSettings } from '../db/schema'
import { eq, isNull, and, like, or, lte, sql } from 'drizzle-orm'
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
// Returns all asset, liability, and equity accounts with their per-currency balances and type.
// "Asset accounts"     = paths starting with defaultAssetsRootPath
// "Liability accounts" = paths starting with defaultLiabilitiesRootPath
// "Equity accounts"    = paths starting with defaultEquityRootPath
// Balance = SUM of all posting amounts for that account, grouped by currency.
// Accounts with no postings are included with an empty balances array.
app.get('/balances', async (c) => {
  const userId = c.get('userId')

  const [settings] = await db
    .select({
      defaultAssetsRootPath: userSettings.defaultAssetsRootPath,
      defaultLiabilitiesRootPath: userSettings.defaultLiabilitiesRootPath,
      defaultEquityRootPath: userSettings.defaultEquityRootPath,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  const assetsRoot = settings?.defaultAssetsRootPath ?? 'assets'
  const liabilitiesRoot = settings?.defaultLiabilitiesRootPath ?? 'liabilities'
  const equityRoot = settings?.defaultEquityRootPath ?? 'equity'

  // LEFT JOIN so accounts with no postings still appear (with null currency/balance)
  const rows = await db
    .select({
      id: accounts.id,
      path: accounts.path,
      name: accounts.name,
      currency: postings.currency,
      balance: sql<string>`SUM(${postings.amount})`,
    })
    .from(accounts)
    .leftJoin(postings, and(eq(postings.accountId, accounts.id), isNull(postings.deletedAt)))
    .where(and(
      eq(accounts.userId, userId),
      isNull(accounts.deletedAt),
      or(
        like(accounts.path, `${assetsRoot}:%`),
        like(accounts.path, `${liabilitiesRoot}:%`),
        like(accounts.path, `${equityRoot}:%`),
      ),
    ))
    .groupBy(accounts.id, accounts.path, accounts.name, postings.currency)

  // Collapse the flat rows into one entry per account with a balances array
  type AccountType = 'asset' | 'liability' | 'equity'
  const grouped = new Map<string, { id: string; path: string; name: string | null; type: AccountType; balances: { currency: string; amount: string }[] }>()
  for (const row of rows) {
    if (!grouped.has(row.id)) {
      let type: AccountType
      if (row.path.startsWith(`${assetsRoot}:`)) type = 'asset'
      else if (row.path.startsWith(`${liabilitiesRoot}:`)) type = 'liability'
      else type = 'equity'
      grouped.set(row.id, { id: row.id, path: row.path, name: row.name, type, balances: [] })
    }
    if (row.currency !== null && row.balance !== null) {
      grouped.get(row.id)!.balances.push({ currency: row.currency, amount: row.balance })
    }
  }

  return c.json([...grouped.values()])
})

// GET /api/accounts/posting-counts
// Returns { accountId, count }[] for all accounts belonging to this user.
// Counts only non-deleted postings.
app.get('/posting-counts', async (c) => {
  const userId = c.get('userId')
  const rows = await db
    .select({
      accountId: postings.accountId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(eq(accounts.userId, userId), isNull(postings.deletedAt), isNull(accounts.deletedAt)))
    .groupBy(postings.accountId)
  return c.json(rows)
})

// GET /api/accounts/:id/balance?date=YYYY-MM-DD
// Returns the ledger balance for one account as of the end of the given date.
// Balance = SUM of postings in non-deleted transactions on or before the date, grouped by currency.
app.get('/:id/balance', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.param('id')
  const dateParam = c.req.query('date')

  if (!dateParam) return c.json({ error: 'date query parameter is required' }, 400)

  // Parse as a local date — treat the param as midnight UTC on that day.
  const asOf = new Date(`${dateParam}T23:59:59.999Z`)
  if (isNaN(asOf.getTime())) return c.json({ error: 'invalid date format, expected YYYY-MM-DD' }, 400)

  // Verify the account belongs to this user
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!account) return c.json({ error: 'account not found' }, 404)

  const rows = await db
    .select({
      currency: postings.currency,
      amount: sql<string>`SUM(${postings.amount})`,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(
      eq(postings.accountId, accountId),
      isNull(postings.deletedAt),
      isNull(transactions.deletedAt),
      lte(transactions.date, asOf),
    ))
    .groupBy(postings.currency)

  return c.json({
    accountId,
    date: dateParam,
    balances: rows.map(r => ({ currency: r.currency, amount: r.amount ?? '0.00' })),
  })
})

// Raw row shapes returned by the action-required SQL queries.
type ActionRequiredSummaryRow = { account_id: string; count: number }
type ActionRequiredIdRow = { id: string }

// Shared helper: loads defaultOffsetAccountId from user settings.
async function getActionRequiredSettings(userId: string) {
  const [settings] = await db
    .select({ defaultOffsetAccountId: userSettings.defaultOffsetAccountId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return { offsetAccountId: settings?.defaultOffsetAccountId ?? null }
}

// The WHERE clause body shared by both action-required endpoints.
// A transaction needs action if it has a posting to the user's
// defaultOffsetAccountId (uncategorized). Returns null when offsetAccountId is
// not configured — callers skip the query entirely in that case.
function actionRequiredCondition(offsetAccountId: string | null) {
  if (offsetAccountId === null) return null

  return sql`EXISTS (
    SELECT 1 FROM postings p
    WHERE p.transaction_id = t.id
      AND p.deleted_at IS NULL
      AND p.account_id = ${offsetAccountId}
  )`
}

// GET /api/accounts/action-required-summary
// Returns { accountId, count }[] for all accounts that have at least one action-required
// transaction. Accounts with nothing to fix are omitted. Used by the sidebar and the
// account page badge (lazy — full ID list is only fetched on demand).
app.get('/action-required-summary', async (c) => {
  const userId = c.get('userId')
  const { offsetAccountId } = await getActionRequiredSettings(userId)
  const condition = actionRequiredCondition(offsetAccountId)
  if (!condition) return c.json([])

  const result = await db.execute(sql`
    SELECT anchor.account_id, COUNT(DISTINCT t.id)::int AS count
    FROM transactions t
    JOIN postings anchor ON anchor.transaction_id = t.id AND anchor.deleted_at IS NULL
    WHERE t.user_id = ${userId}
      AND t.deleted_at IS NULL
      AND ${condition}
    GROUP BY anchor.account_id
  `)

  return c.json(
    (result as unknown as ActionRequiredSummaryRow[]).map((r) => ({
      accountId: r.account_id,
      count: r.count,
    })),
  )
})

// GET /api/accounts/:id/action-required
// Returns { count, transactionIds[] } for one account. Only fetched when the user
// clicks the filter button — the summary endpoint covers the initial badge display.
app.get('/:id/action-required', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.param('id')

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!account) return c.json({ error: 'account not found' }, 404)

  const { offsetAccountId } = await getActionRequiredSettings(userId)
  const condition = actionRequiredCondition(offsetAccountId)
  if (!condition) return c.json({ count: 0, transactionIds: [] })

  const result = await db.execute(sql`
    SELECT DISTINCT t.id
    FROM transactions t
    JOIN postings anchor ON anchor.transaction_id = t.id
      AND anchor.account_id = ${accountId}
      AND anchor.deleted_at IS NULL
    WHERE t.user_id = ${userId}
      AND t.deleted_at IS NULL
      AND ${condition}
  `)

  const transactionIds = (result as unknown as ActionRequiredIdRow[]).map((r) => r.id)
  return c.json({ count: transactionIds.length, transactionIds })
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

app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const allowed = ['name'] as const
  const updates: Partial<typeof body> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields to update' }, 400)
  const [updated] = await db
    .update(accounts)
    .set(updates)
    .where(and(eq(accounts.id, c.req.param('id')), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
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
