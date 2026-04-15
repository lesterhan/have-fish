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
type MissingRateRow = { date: string; from_currency: string; to_currency: string }

// Shared helper: loads preferredCurrency and defaultOffsetAccountId from user settings.
async function getActionRequiredSettings(userId: string) {
  const [settings] = await db
    .select({
      preferredCurrency: userSettings.preferredCurrency,
      defaultOffsetAccountId: userSettings.defaultOffsetAccountId,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return {
    preferredCurrency: settings?.preferredCurrency ?? 'CAD',
    offsetAccountId: settings?.defaultOffsetAccountId ?? null,
  }
}

// The WHERE clause body shared by both action-required endpoints.
// A transaction needs action if ANY of:
//   1. It has a foreign-currency posting with no cached FX rate.
//   2. It has a posting to the user's defaultOffsetAccountId (uncategorized).
//
// Condition 2 is omitted from the SQL entirely when offsetAccountId is null —
// avoids the PostgreSQL "could not determine data type of parameter" error that
// occurs when a bare parameter appears in an IS NOT NULL check without type context.
function actionRequiredCondition(preferredCurrency: string, offsetAccountId: string | null) {
  const condition1 = sql`EXISTS (
    SELECT 1 FROM postings p
    WHERE p.transaction_id = t.id
      AND p.deleted_at IS NULL
      AND p.currency != ${preferredCurrency}
      AND NOT EXISTS (
        SELECT 1 FROM fx_rates fx
        WHERE fx.date = to_char(t.date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
          AND fx.base_currency = p.currency
          AND fx.quote_currency = ${preferredCurrency}
      )
  )`

  if (offsetAccountId === null) {
    return sql`(${condition1})`
  }

  const condition2 = sql`EXISTS (
    SELECT 1 FROM postings p2
    WHERE p2.transaction_id = t.id
      AND p2.deleted_at IS NULL
      AND p2.account_id = ${offsetAccountId}
  )`

  return sql`(${condition1} OR ${condition2})`
}

// GET /api/accounts/action-required-summary
// Returns { accountId, count }[] for all accounts that have at least one action-required
// transaction. Accounts with nothing to fix are omitted. Used by the sidebar and the
// account page badge (lazy — full ID list is only fetched on demand).
app.get('/action-required-summary', async (c) => {
  const userId = c.get('userId')
  const { preferredCurrency, offsetAccountId } = await getActionRequiredSettings(userId)
  const condition = actionRequiredCondition(preferredCurrency, offsetAccountId)

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

  const { preferredCurrency, offsetAccountId } = await getActionRequiredSettings(userId)
  const condition = actionRequiredCondition(preferredCurrency, offsetAccountId)

  const [txResult, ratesResult] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT t.id
      FROM transactions t
      JOIN postings anchor ON anchor.transaction_id = t.id
        AND anchor.account_id = ${accountId}
        AND anchor.deleted_at IS NULL
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND ${condition}
    `),
    // Distinct (date, currency) pairs that are missing FX rates for this account.
    db.execute(sql`
      SELECT DISTINCT
        to_char(t.date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        p.currency AS from_currency,
        ${preferredCurrency} AS to_currency
      FROM transactions t
      JOIN postings anchor ON anchor.transaction_id = t.id
        AND anchor.account_id = ${accountId}
        AND anchor.deleted_at IS NULL
      JOIN postings p ON p.transaction_id = t.id
        AND p.deleted_at IS NULL
        AND p.currency != ${preferredCurrency}
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM fx_rates fx
          WHERE fx.date = to_char(t.date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
            AND fx.base_currency = p.currency
            AND fx.quote_currency = ${preferredCurrency}
        )
      ORDER BY date ASC
    `),
  ])

  const transactionIds = (txResult as unknown as ActionRequiredIdRow[]).map((r) => r.id)
  const missingRates = (ratesResult as unknown as MissingRateRow[]).map((r) => ({
    date: r.date,
    from: r.from_currency,
    to: r.to_currency,
  }))
  return c.json({ count: transactionIds.length, transactionIds, missingRates })
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
