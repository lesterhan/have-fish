import { Hono } from 'hono'
import { db } from '../db'
import { accountCoverage, accounts, postings, transactions, userSettings } from '../db/schema'
import { and, between, desc, eq, isNull, sql } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { addDays, mergeCoverage } from '../coverage/intervals'
import {
  effectiveConfig,
  horizon,
  inferCycleFromIntervals,
  isCycleDay,
  isReleaseLag,
  mergeConfig,
  nextHorizon,
  readCatchUpOverrides,
  readIntervals,
  type CoverageConfigOverride,
} from '../coverage/horizon'

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

// The default span the coverage strip draws. Roughly a quarter — long enough to show a
// statement rhythm, short enough that a day cell stays wide enough to hover.
const DEFAULT_WINDOW_DAYS = 90

// Two years. Past this the strip is unreadable at any cell width, and the transaction scan
// stops being cheap.
const MAX_WINDOW_DAYS = 730

// Reads one account's live assertions, newest first, alongside the coalesced spans.
//
// Both shapes are returned because they answer different questions: the merged spans are what
// "covered through D" is read off, while the raw rows are the only thing carrying the ids that
// DELETE needs — a merged span has no id to undo.
async function readCoverage(userId: string, accountId: string, windowDays: number) {
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

  // The horizon travels with the coverage because the strip needs both to render: covered days
  // and uncovered days are only distinguishable from not-yet-obtainable ones once you know
  // where the account's data actually stops being available.
  const config = await effectiveConfig(userId, accountId)
  const today = todayUtc()
  const windowFrom = addDays(today, -(windowDays - 1))

  // Distinct dates only — the strip draws one tick per day, not per transaction. Scoped to the
  // window so an account with a decade of history doesn't ship a decade of dates to draw 90
  // cells with.
  const txnDateRows = await db
    .selectDistinct({ date: sql<string>`to_char(${transactions.date}::date, 'YYYY-MM-DD')` })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(postings.accountId, accountId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      between(
        sql`${transactions.date}::date`,
        sql`${windowFrom}::date`,
        sql`${today}::date`,
      ),
    ))

  return {
    accountId,
    intervals,
    assertions: rows,
    config,
    horizon: horizon(config, today),
    nextHorizon: nextHorizon(config, today),
    // The window the strip draws, and the days inside it that already have transactions.
    window: { from: windowFrom, to: today, days: windowDays },
    txnDates: txnDateRows.map((r) => r.date).sort(),
  }
}

// Clamps ?days= to something drawable. A bad value falls back to the default rather than
// erroring — the strip is a read-only view, and refusing to render it over a query string
// typo helps nobody.
function windowDaysFrom(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_WINDOW_DAYS
  return Math.min(parsed, MAX_WINDOW_DAYS)
}

// UTC so the horizon doesn't shift under a traveller crossing timezones — the same convention
// the rest of the app stores dates with.
function todayUtc(): string {
  return new Date().toISOString().substring(0, 10)
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

// PATCH /api/coverage/config/:accountId
// Pins part of an account's catch-up config by hand, overriding what inference guessed.
//
// Body keys are all optional: { exportMode, cycleDay, releaseLag, tracked }. Passing null for
// a key *removes* that override and hands the field back to inference — which is why "this
// account has no statement cycle" is expressed as exportMode: 'range' rather than
// cycleDay: null.
//
// Stored under preferences.catchUp[accountId] rather than in a column on accounts, following
// the same precedent as the other display preferences. Only the overrides live there; the
// effective config is always inference with these laid on top.
// 200: { accountId, override, config, horizon, nextHorizon }
// 400: an invalid field value, or a cycle account with no cycle day to compute closes from
// 404: account not found or not owned by the caller
app.patch('/config/:accountId', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.param('accountId')

  if (!isUuid(accountId)) return c.json({ error: 'account not found' }, 404)

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)

  // Distinguishes "clear this override" (explicit null) from "leave it alone" (key absent).
  const cleared = new Set<keyof CoverageConfigOverride>()
  const patch: CoverageConfigOverride = {}

  if ('exportMode' in body) {
    if (body.exportMode === null) cleared.add('exportMode')
    else if (body.exportMode === 'range' || body.exportMode === 'cycle') patch.exportMode = body.exportMode
    else return c.json({ error: "exportMode must be 'range', 'cycle', or null" }, 400)
  }
  if ('cycleDay' in body) {
    if (body.cycleDay === null) cleared.add('cycleDay')
    else if (isCycleDay(body.cycleDay)) patch.cycleDay = body.cycleDay
    else return c.json({ error: 'cycleDay must be a whole number from 1 to 31, or null' }, 400)
  }
  if ('releaseLag' in body) {
    if (body.releaseLag === null) cleared.add('releaseLag')
    else if (isReleaseLag(body.releaseLag)) patch.releaseLag = body.releaseLag
    else return c.json({ error: 'releaseLag must be a whole number from 0 to 31, or null' }, 400)
  }
  if ('tracked' in body) {
    if (body.tracked === null) cleared.add('tracked')
    else if (typeof body.tracked === 'boolean') patch.tracked = body.tracked
    else return c.json({ error: 'tracked must be a boolean or null' }, 400)
  }

  if (cleared.size === 0 && Object.keys(patch).length === 0) {
    return c.json({ error: 'no valid fields to update' }, 400)
  }

  if (!(await ownsAccount(userId, accountId))) {
    return c.json({ error: 'account not found' }, 404)
  }

  const [overrides, intervals] = await Promise.all([
    readCatchUpOverrides(userId),
    readIntervals(userId, accountId),
  ])

  const override: CoverageConfigOverride = { ...(overrides[accountId] ?? {}), ...patch }
  for (const key of cleared) delete override[key]

  const config = mergeConfig(inferCycleFromIntervals(intervals), override)

  // Refuse the one combination that cannot be computed. horizon() falls back to today rather
  // than inventing a boundary, but silently ignoring what the user asked for would leave them
  // staring at a 'cycle' account behaving exactly like a 'range' one.
  if (config.exportMode === 'cycle' && config.cycleDay == null) {
    return c.json({ error: 'a cycle account needs a cycleDay' }, 400)
  }

  await writeOverride(userId, accountId, override)

  const today = todayUtc()
  return c.json({
    accountId,
    override,
    config,
    horizon: horizon(config, today),
    nextHorizon: nextHorizon(config, today),
  })
})

// Writes one account's overrides into preferences.catchUp without disturbing anything else in
// the blob. Nested jsonb_set rather than the `||` shallow merge the settings route uses:
// `||` at the top level would replace the whole catchUp object and wipe every other account's
// config, and at the catchUp level it could not remove a cleared key.
async function writeOverride(userId: string, accountId: string, override: CoverageConfigOverride) {
  const existing = sql`COALESCE(${userSettings.preferences}, '{}'::jsonb)`

  const next = Object.keys(override).length === 0
    // Nothing pinned any more — drop the key entirely so the blob doesn't accumulate empty
    // objects for every account the user has ever poked at.
    ? sql`${existing} #- ARRAY['catchUp', ${accountId}]::text[]`
    : sql`jsonb_set(
        jsonb_set(${existing}, '{catchUp}'::text[], COALESCE(${existing}->'catchUp', '{}'::jsonb), true),
        ARRAY['catchUp', ${accountId}]::text[],
        ${JSON.stringify(override)}::jsonb,
        true
      )`

  await db
    .insert(userSettings)
    .values({ userId, preferences: { catchUp: { [accountId]: override } } })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { preferences: next, updatedAt: new Date() },
    })
}

export default app

// Mounted separately at /api/accounts so coverage reads hang off the account they describe.
// Kept in this file rather than accounts.ts to keep everything coverage-shaped together.
export const accountCoverageRoute = new Hono<{ Variables: AppVariables }>()

// GET /api/accounts/:id/coverage?days=90
// 200: { accountId, intervals, assertions, config, horizon, nextHorizon, window, txnDates }
//      — merged spans and the raw rows behind them, both newest first, plus everything the
//      coverage strip needs to draw a day cell in the right state
// 404: account not found or not owned by the caller
accountCoverageRoute.get('/:id/coverage', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.param('id')

  if (!isUuid(accountId)) return c.json({ error: 'account not found' }, 404)
  if (!(await ownsAccount(userId, accountId))) {
    return c.json({ error: 'account not found' }, 404)
  }

  return c.json(await readCoverage(userId, accountId, windowDaysFrom(c.req.query('days'))))
})
