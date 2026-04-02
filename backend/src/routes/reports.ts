import { Hono } from 'hono'
import { db } from '../db'
import { transactions, postings, accounts, userSettings } from '../db/schema'
import { eq, isNull, and, gte, lte, like } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/reports/spending-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns total spend and per-category breakdown for expense accounts only.
// Amounts are per currency (no conversion). Categories are the first two path
// segments of the account path (e.g. "expenses:food" for "expenses:food:restaurant").
app.get('/spending-summary', async (c) => {
  const userId = c.get('userId')
  const from = c.req.query('from')
  const to = c.req.query('to')

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (from && !dateRe.test(from)) return c.json({ error: 'Invalid from date, expected YYYY-MM-DD' }, 400)
  if (to && !dateRe.test(to)) return c.json({ error: 'Invalid to date, expected YYYY-MM-DD' }, 400)

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const expensesRoot = settings?.defaultExpensesRootPath ?? 'expenses'
  // Escape LIKE special characters in the root path so a user-configured value
  // like "expenses%" can't broaden the match unexpectedly.
  const escapedRoot = expensesRoot.replace(/[%_\\]/g, '\\$&')

  const rows = await db
    .select({
      path: accounts.path,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      isNull(accounts.deletedAt),
      like(accounts.path, `${escapedRoot}:%`),
      from ? gte(transactions.date, new Date(from)) : undefined,
      to ? lte(transactions.date, new Date(`${to}T23:59:59.999Z`)) : undefined,
    ))

  // Aggregate totals per currency and per top-level category
  const totalByCurrency: Record<string, number> = {}
  const categoryMap: Record<string, Record<string, number>> = {}

  for (const row of rows) {
    const amount = parseFloat(row.amount)
    const { currency } = row

    // Top-level category: first two path segments (e.g. "expenses:food:restaurant" → "expenses:food")
    const segments = row.path.split(':')
    const category = segments.length >= 2 ? `${segments[0]}:${segments[1]}` : segments[0]

    totalByCurrency[currency] = (totalByCurrency[currency] ?? 0) + amount
    categoryMap[category] ??= {}
    categoryMap[category][currency] = (categoryMap[category][currency] ?? 0) + amount
  }

  const categories = Object.entries(categoryMap).map(([category, byCurrency]) => ({
    category,
    total: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)])
    ),
  }))

  return c.json({
    total: Object.fromEntries(
      Object.entries(totalByCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)])
    ),
    categories,
  })
})

export default app
