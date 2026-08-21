import { Hono } from 'hono'
import { db } from '../db'
import { accountCoverage, accounts } from '../db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { mergeCoverage } from '../coverage/intervals'

const app = new Hono<{ Variables: AppVariables }>()

// The four ways an assertion can come to exist. Provenance only — a range covered by an
// 'empty' click counts exactly as much as one covered by an imported statement.
const SOURCES = ['import', 'reconcile', 'manual', 'empty'] as const
type CoverageSource = (typeof SOURCES)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Guards every id before it reaches a uuid column — Postgres raises on a malformed uuid,
// which would surface as a 500 where the honest answer is "no such row".
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

// Accepts only a real calendar date in ISO form. The round-trip is what rejects 2025-02-30:
// the regex passes it, but Date rolls it forward to 2025-03-02 and the strings stop matching.
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().substring(0, 10) === value
}

// Confirms the account exists and belongs to the caller. Coverage is an assertion about
// someone's ledger, so writing one against an account you don't own must be impossible.
async function ownsAccount(userId: string, accountId: string): Promise<boolean> {
  const [owned] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  return owned != null
}

// Reads one account's live assertions, newest first, alongside the coalesced spans.
//
// Both shapes are returned because they answer different questions: the merged spans are what
// "covered through D" is read off, while the raw rows are the only thing carrying the ids that
// DELETE needs — a merged span has no id to undo.
async function readCoverage(userId: string, accountId: string) {
  const rows = await db
    .select({
      id: accountCoverage.id,
      fromDate: accountCoverage.fromDate,
      throughDate: accountCoverage.throughDate,
      source: accountCoverage.source,
      note: accountCoverage.note,
      createdAt: accountCoverage.createdAt,
    })
    .from(accountCoverage)
    .where(
      and(
        eq(accountCoverage.userId, userId),
        eq(accountCoverage.accountId, accountId),
        isNull(accountCoverage.deletedAt),
      ),
    )
    .orderBy(desc(accountCoverage.fromDate), desc(accountCoverage.throughDate))

  // mergeCoverage returns ascending; the UI reads most-recent-first, same as every other listing.
  const intervals = mergeCoverage(rows).reverse()

  return { accountId, intervals, assertions: rows }
}

// POST /api/coverage
// Asserts that an account's ledger is complete for an inclusive date range.
// Body: { accountId, fromDate, throughDate, source, note? }
// 201: the created row
// 400: malformed dates, inverted range, or an unknown source
// 404: account not found or not owned by the caller
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)

  const { accountId, fromDate, throughDate, source, note } = body

  if (!isUuid(accountId)) return c.json({ error: 'accountId must be a UUID string' }, 400)
  if (!isIsoDate(fromDate)) return c.json({ error: 'fromDate must be a YYYY-MM-DD date' }, 400)
  if (!isIsoDate(throughDate)) return c.json({ error: 'throughDate must be a YYYY-MM-DD date' }, 400)
  if (fromDate > throughDate) {
    return c.json({ error: 'fromDate must be on or before throughDate' }, 400)
  }
  if (typeof source !== 'string' || !SOURCES.includes(source as CoverageSource)) {
    return c.json({ error: `source must be one of ${SOURCES.join(', ')}` }, 400)
  }
  if (note != null && typeof note !== 'string') {
    return c.json({ error: 'note must be a string' }, 400)
  }

  if (!(await ownsAccount(userId, accountId))) {
    return c.json({ error: 'account not found' }, 404)
  }

  // No reconciliation against existing rows — overlaps and duplicates are allowed to pile up
  // and are coalesced on read. Keeping writes dumb is what lets an import, a reconcile and a
  // manual assertion all land without any of them needing to know about the others.
  const [created] = await db
    .insert(accountCoverage)
    .values({ userId, accountId, fromDate, throughDate, source, note: note ?? null })
    .returning()

  return c.json(created, 201)
})

// DELETE /api/coverage/:id
// Withdraws an assertion. Soft delete per house convention, so the claim that was once made
// stays on the record even after the user takes it back.
// 204: deleted, or already gone
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!isUuid(id)) return c.body(null, 204)

  await db
    .update(accountCoverage)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(accountCoverage.id, id),
        eq(accountCoverage.userId, userId),
        isNull(accountCoverage.deletedAt),
      ),
    )

  return c.body(null, 204)
})

export default app

// Mounted separately at /api/accounts so coverage reads hang off the account they describe.
// Kept in this file rather than accounts.ts to keep everything coverage-shaped together.
export const accountCoverageRoute = new Hono<{ Variables: AppVariables }>()

// GET /api/accounts/:id/coverage
// 200: { accountId, intervals, assertions } — merged spans and the raw rows behind them,
//      both newest first
// 404: account not found or not owned by the caller
accountCoverageRoute.get('/:id/coverage', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.param('id')

  if (!isUuid(accountId)) return c.json({ error: 'account not found' }, 404)
  if (!(await ownsAccount(userId, accountId))) {
    return c.json({ error: 'account not found' }, 404)
  }

  return c.json(await readCoverage(userId, accountId))
})
