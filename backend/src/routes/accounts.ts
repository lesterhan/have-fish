import { Hono } from 'hono'
import { z } from 'zod'
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  renameAccounts,
  updateAccount,
} from '../accounts/account-service'
import { actionRequiredFor, actionRequiredSummary } from '../accounts/action-required-service'
import { accountBalances, balanceAsOf, postingCounts } from '../accounts/balance-service'
import { readBalanceSelection } from '../accounts/balances'
import { isValidPath } from '../accounts/paths'
import type { AppVariables } from '../app'
import { isCalendarDate } from '../calendar-date'
import { isValidCurrency } from '../currencies'
import { isStoredAccountType, type StoredAccountType } from '../postings/account-type'
import { fail, failWith } from '../respond'
import { as, asField, asInput, defined, parseBody } from '../validation'

// The handlers parse the request and answer; the rules and queries are in `accounts/`.

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/accounts
// Every active account, with `resolvedType` beside the raw stored `type`.
app.get('/', async (c) => c.json(await listAccounts(c.get('userId'))))

// GET /api/accounts/balances[?types=cash,asset][?include=unfiled]
// Balance-bearing accounts (asset, liability and equity by RESOLVED type) with their
// per-currency balances; `readBalanceSelection` says what the two parameters do and refuse.
// Accounts with no postings are included with an empty balances array.
//
// `type` and `resolvedType` mean exactly what they mean on GET /api/accounts: the raw stored
// override, and the effective resolved answer. This endpoint used to report
// a third thing under `type` — a coarse asset/liability/equity bucket — which made the same
// field name mean two different things depending on which route you called. Callers that want
// that bucket derive it with `toClassifierType(resolvedType)`, the same function the role
// classifier uses, so there is one implementation of the collapse rather than two.
app.get('/balances', async (c) => {
  const selection = readBalanceSelection(c.req.query('types'), c.req.query('include'))
  if (!selection.ok) return failWith(c, selection.failure)
  return c.json(await accountBalances(c.get('userId'), selection.value))
})

// GET /api/accounts/posting-counts
// { accountId, count, lastActivity }[] for every active account, including those never
// posted to (count 0, lastActivity null).
app.get('/posting-counts', async (c) => c.json(await postingCounts(c.get('userId'))))

// GET /api/accounts/:id/balance?date=YYYY-MM-DD
// One account's balance per currency as of the end of the given date, inclusive.
app.get('/:id/balance', async (c) => {
  const date = c.req.query('date')
  if (!date) return fail(c, 'FIELD_REQUIRED', { field: 'date' })
  if (!isCalendarDate(date)) return fail(c, 'FIELD_NOT_DATE', { field: 'date' })

  const result = await balanceAsOf(c.get('userId'), c.req.param('id'), date)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// GET /api/accounts/action-required-summary
// { accountId, count }[] for every account with at least one transaction needing attention:
// uncategorized, or a malformed cross-currency spend. Used by the sidebar dot and the account
// page badge.
app.get('/action-required-summary', async (c) =>
  c.json(await actionRequiredSummary(c.get('userId'))),
)

// GET /api/accounts/:id/action-required
// { count, transactionIds, malformedTransactionIds } for one account. Only fetched when the
// user turns the filter on; the summary covers the badge.
app.get('/:id/action-required', async (c) => {
  const result = await actionRequiredFor(c.get('userId'), c.req.param('id'))
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// GET /api/accounts/:id
// One account with its resolved type, and what "Auto" would resolve to and from where.
app.get('/:id', async (c) => {
  const result = await getAccount(c.get('userId'), c.req.param('id'))
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// `default_currency` is a plain text column, so an unvalidated write is stored verbatim and
// every later FX lookup quietly fails on a code that does not exist. null is meaningful — it
// clears the pin and hands the account back to the user's preferred currency.
type CurrencyRead = { ok: true; value: string | null } | { ok: false }

function readCurrency(value: unknown): CurrencyRead {
  if (value === null) return { ok: true, value: null }
  if (typeof value === 'string' && isValidCurrency(value)) {
    return { ok: true, value: value.toUpperCase() }
  }
  return { ok: false }
}

// The four fields the two write routes share, as schema.
//
// Each one keeps the failure the route already answered with, which is why `path`,
// `defaultCurrency` and `type` are `unknown` refined by this file's own predicates rather
// than `z.string()` and `z.enum()`: `ACCOUNT_PATH_INVALID`, `UNSUPPORTED_CURRENCY` with
// the offending code, and `ACCOUNT_TYPE_INVALID` with the offending type all say more
// than "wrong type" would.
const accountPath = z
  .unknown()
  .refine((v) => typeof v === 'string' && isValidPath(v), { error: as('ACCOUNT_PATH_INVALID') })
  .transform(String)

/** null clears the override and falls back to the user's default; anything else must be real. */
const currencyOverride = z
  .unknown()
  .refine((v) => readCurrency(v).ok, {
    error: asInput('UNSUPPORTED_CURRENCY', (v) => ({ currency: String(v) })),
  })
  .transform((v) => (typeof v === 'string' ? v.toUpperCase() : null))

/** null means infer from the path; anything else must be one of the seven hledger types. */
const typeOverride = z
  .unknown()
  .refine((v) => v === null || isStoredAccountType(v), {
    error: asInput('ACCOUNT_TYPE_INVALID', (v) => ({ type: String(v) })),
  })
  .transform((v) => (v === null ? null : (v as StoredAccountType)))

const accountName = z.string({ error: asField('FIELD_NOT_STRING') }).nullable()

// POST /api/accounts
// Creates one account. Body: { path, name?, defaultCurrency?, type? }.
//
// The four fields are named rather than spread. Spreading the request body into the insert
// made every column on the table client-settable: an `id` of the caller's choosing, a
// `createdAt` backdated to anywhere, or a `deletedAt` that produced an account born invisible.
// `userId` was overridden and so was never reachable, but that was one field's luck rather
// than a rule.
//
// 400: no path, a malformed one, the system-managed receivable namespace, or a type or
// currency this route would refuse on update.
const NewAccount = z.object({
  path: accountPath,
  name: accountName.optional(),
  defaultCurrency: currencyOverride.optional(),
  type: typeOverride.optional(),
})

app.post('/', async (c) => {
  const parsed = await parseBody(c, NewAccount)
  if (!parsed.ok) return parsed.response
  // The parsed body, not the request's: the schema has already dropped every key that is
  // not one of the four, which is what keeps an `id` or a `userId` of the caller's choosing
  // out of the insert.
  const result = await createAccount(c.get('userId'), defined(parsed.data))
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value, 201)
})

// POST /api/accounts/rename
// Rewrites an account path prefix `from` → `to` across the node itself and every
// descendant, in one transaction. `planRename` in `accounts/paths.ts` has the rules.
//
// Both halves are required together, and the route has always said so as one failure
// naming both rather than two failures naming one each.
const bothRequired = as('FIELDS_REQUIRED', { fields: ['from', 'to'] })
const renamePart = z.string({ error: bothRequired }).min(1, { error: bothRequired })

const Rename = z.object({ from: renamePart, to: renamePart })

app.post('/rename', async (c) => {
  const parsed = await parseBody(c, Rename)
  if (!parsed.ok) return parsed.response
  const result = await renameAccounts(c.get('userId'), parsed.data.from, parsed.data.to)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// `path` is not here on purpose: moving an account is `POST /rename`, which has to
// cascade over the subtree. Letting a patch write `path` would move one node and orphan
// its children.
const AccountPatch = z.object({
  name: accountName.optional(),
  defaultCurrency: currencyOverride.optional(),
  type: typeOverride.optional(),
})

app.patch('/:id', async (c) => {
  const parsed = await parseBody(c, AccountPatch)
  if (!parsed.ok) return parsed.response
  const updates = defined(parsed.data)
  if (Object.keys(updates).length === 0) return fail(c, 'NO_FIELDS_TO_UPDATE')

  const result = await updateAccount(c.get('userId'), c.req.param('id'), updates)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// DELETE /api/accounts/:id
// Soft-deletes an account nothing depends on; `deleteAccount` says what counts.
app.delete('/:id', async (c) => {
  const result = await deleteAccount(c.get('userId'), c.req.param('id'))
  if (!result.ok) return failWith(c, result.failure)
  return c.body(null, 204)
})

export default app
