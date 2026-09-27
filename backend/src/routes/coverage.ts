import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import {
  assertCoverage,
  monthCoverage,
  readCoverage,
  reconcileCoverage,
  SOURCES,
  updateCoverageConfig,
  withdrawCoverage,
} from '../coverage/coverage-service'
import { configChangeFrom, isCycleDay, isReleaseLag } from '../coverage/horizon'
import { loadCoverageAccounts, todayUtc } from '../coverage/load-service'
import { monthsBetween } from '../coverage/months'
import { fail, failWith } from '../respond'
import { as, asField, defined, parseBody } from '../validation'

// The handlers parse the request and answer; the rules and queries are in `coverage/`.

const app = new Hono<{ Variables: AppVariables }>()

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

// The two field shapes every body here is built from. `uuid` and `isoDate` restate the
// guards above as schema, so a route's body is checked in one place instead of a chain.
const uuid = z.string({ error: asField('FIELD_NOT_UUID') }).refine(isUuid, {
  error: asField('FIELD_NOT_UUID'),
})
const isoDate = z.string({ error: asField('FIELD_NOT_DATE') }).refine(isIsoDate, {
  error: asField('FIELD_NOT_DATE'),
})

// The default span the coverage strip draws. Roughly a quarter — long enough to show a
// statement rhythm, short enough that a day cell stays wide enough to hover.
const DEFAULT_WINDOW_DAYS = 90

// Two years. Past this the strip is unreadable at any cell width, and the transaction scan
// stops being cheap.
const MAX_WINDOW_DAYS = 730

// Clamps ?days= to something drawable. A bad value falls back to the default rather than
// erroring — the strip is a read-only view, and refusing to render it over a query string
// typo helps nobody.
function windowDaysFrom(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_WINDOW_DAYS
  return Math.min(parsed, MAX_WINDOW_DAYS)
}

// GET /api/coverage/accounts
// The coverage state of every tracked account, and nothing else.
//
// This is GET /api/catch-up projected down to the three fields that answer "can I believe a
// figure these accounts add up to". The coach payload carries a 90-day strip and a full
// interval list per account, which is the right weight for a page built to show coverage and
// far too much for a page that only needs to date a total. Both go through the same loader,
// so an account can never read as behind on one surface and current on the other.
//
// An account MISSING from this list is not a contributor to any completeness date: it is
// hidden, flagged illiquid, dismissed with tracked: false, a Fish Pie clearing account, or
// not asset/liability at all. The user has said, in one way or another, that it is not
// something they fall behind on — so like a dormant account, it holds no total back.
// 200: { today, accounts: [{ accountId, state, coveredThrough, dormant }] }
app.get('/accounts', async (c) => {
  const today = todayUtc()
  // No spans: firstTxnDate/lastTxnDate exist for bootstrap, and paying an unbounded aggregate
  // over every posting to date a rollup would make the honest number the expensive one.
  const assembled = await loadCoverageAccounts(c.get('userId'), today)

  return c.json({
    today,
    accounts: assembled.map((a) => ({
      accountId: a.accountId,
      state: a.state,
      coveredThrough: a.coveredThrough,
      dormant: a.dormant,
    })),
  })
})

// Widest span the month endpoint will classify at once. The spending page asks for seven; a
// range longer than a few years is a caller mistake, not a use case.
const MAX_MONTHS = 36

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// GET /api/coverage/months?from=YYYY-MM&to=YYYY-MM
// Whether each calendar month in the range is actually recorded, and by how much.
//
// This is the question `GET /api/coverage/accounts` cannot answer. A leading edge says how
// current an account is; it says nothing about a hole behind it, and a month sitting in that
// hole is unrecorded however recent the edge is.
//
// `monthCoverage` says what the scope is and what `assertedAccounts` is for.
// 200: { today, assertedAccounts, months: [{ month, state, completeThrough, through, contributors, gaps }] }
// 400: malformed or inverted range, or a span over 36 months
app.get('/months', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')

  if (!from || !MONTH_RE.test(from)) return fail(c, 'FIELD_NOT_MONTH', { field: 'from' })
  if (!to || !MONTH_RE.test(to)) return fail(c, 'FIELD_NOT_MONTH', { field: 'to' })
  if (from > to) return fail(c, 'RANGE_OUT_OF_ORDER', { from: 'from', to: 'to' })

  const months = monthsBetween(from, to)
  if (months.length > MAX_MONTHS) {
    return fail(c, 'RANGE_TOO_LONG', { months: MAX_MONTHS })
  }

  return c.json(await monthCoverage(c.get('userId'), months))
})

// POST /api/coverage
// Asserts that an account's ledger is complete for an inclusive date range.
// Body: { accountId, fromDate, throughDate, source, note? }
// 201: the created row
// 400: malformed dates, inverted range, or an unknown source
// 404: account not found or not owned by the caller
const CreateCoverage = z
  .object({
    accountId: uuid,
    fromDate: isoDate,
    throughDate: isoDate,
    source: z.enum(SOURCES, {
      error: as('FIELD_NOT_IN_SET', { field: 'source', allowed: SOURCES }),
    }),
    note: z.string().nullish(),
  })
  // Ordering is a rule about two fields at once, so it lives on the object rather than on
  // either of them.
  .refine((b) => b.fromDate <= b.throughDate, {
    error: as('RANGE_OUT_OF_ORDER', { from: 'fromDate', to: 'throughDate' }),
  })

app.post('/', async (c) => {
  const parsed = await parseBody(c, CreateCoverage)
  if (!parsed.ok) return parsed.response
  const { note, ...assertion } = parsed.data

  const result = await assertCoverage(c.get('userId'), { ...assertion, note: note ?? null })
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value, 201)
})

// DELETE /api/coverage/:id
// Withdraws an assertion. Soft delete per house convention, so the claim that was once made
// stays on the record even after the user takes it back.
// 204: deleted, or already gone
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (isUuid(id)) await withdrawCoverage(c.get('userId'), id)
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
// 200: { accountId, override, config, horizon, nextHorizon }
// 400: an invalid field value, or a cycle account with no cycle day to compute closes from
// Each field is nullable — null clears the override — and optional, since a patch names
// only what it changes. The two range checks carry the codes the hand-written guards used.
const ConfigPatch = z.object({
  exportMode: z
    .enum(['range', 'cycle'], {
      error: as('FIELD_NOT_IN_SET', { field: 'exportMode', allowed: ['range', 'cycle'] }),
    })
    .nullable()
    .optional(),
  cycleDay: z
    .unknown()
    .refine((v) => v === null || isCycleDay(v), {
      error: as('FIELD_OUT_OF_RANGE', { field: 'cycleDay', min: 1, max: 31 }),
    })
    .optional(),
  releaseLag: z
    .unknown()
    .refine((v) => v === null || isReleaseLag(v), {
      error: as('FIELD_OUT_OF_RANGE', { field: 'releaseLag', min: 0, max: 31 }),
    })
    .optional(),
  tracked: z
    .boolean({ error: asField('FIELD_NOT_BOOLEAN') })
    .nullable()
    .optional(),
})

// 404: account not found or not owned by the caller
app.patch('/config/:accountId', async (c) => {
  const accountId = c.req.param('accountId')
  if (!isUuid(accountId)) return fail(c, 'ACCOUNT_NOT_FOUND')

  const parsed = await parseBody(c, ConfigPatch)
  if (!parsed.ok) return parsed.response
  const change = configChangeFrom(defined(parsed.data))
  if (!change) return fail(c, 'NO_FIELDS_TO_UPDATE')

  const result = await updateCoverageConfig(c.get('userId'), accountId, change)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// POST /api/coverage/reconcile
// Records that a reconcile proved this account complete through a date.
//
// `coverage/reconcile.ts` has the rule: where the recorded interval starts, and when a
// reconcile records nothing.
// Body: { accountId, throughDate }
// 200: { created: true, interval } — or { created: false, reason } when D adds nothing
// 400: malformed date
// 404: account not found or not owned by the caller
const Reconcile = z.object({ accountId: uuid, throughDate: isoDate })

app.post('/reconcile', async (c) => {
  const parsed = await parseBody(c, Reconcile)
  if (!parsed.ok) return parsed.response
  const { accountId, throughDate } = parsed.data

  const result = await reconcileCoverage(c.get('userId'), accountId, throughDate)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

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
  const accountId = c.req.param('id')
  if (!isUuid(accountId)) return fail(c, 'ACCOUNT_NOT_FOUND')

  const days = windowDaysFrom(c.req.query('days'))
  const result = await readCoverage(c.get('userId'), accountId, days)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})
