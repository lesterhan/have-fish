import { and, eq, isNull, lte, not, or, type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { db } from '../db'
import { accounts, postings, transactions, userSettings } from '../db/schema'
import { fail } from '../errors'
import { isClearingAccountPath } from '../fish-pie-accounts'
import * as money from '../money'
import {
  type AccountTypeContext,
  explainType,
  isStoredAccountType,
  resolveStoredOrInferredType,
  STORED_ACCOUNT_TYPES,
  type StoredAccountType,
  tagsFrom,
  toClassifierType,
} from '../postings/account-type'
import {
  noUsableOverrideCondition,
  required,
  typeFilterCondition,
  underAnyTypeSourceCondition,
} from '../postings/account-type-sql'
import { loadAccountTypeContext, loadAccountTypeRoots } from '../postings/classify-service'
import { loadHealContext, malformedFxSpendsByAccount } from '../postings/heal-service'
import { as, asField, asInput, defined, parseBody } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

// A valid account path is colon-segmented with no empty segments and no surrounding
// whitespace — rejects '', ':x', 'x:', 'x::y'.
function isValidPath(path: string): boolean {
  if (path !== path.trim() || path.length === 0) return false
  return path.split(':').every((seg) => seg.length > 0 && seg === seg.trim())
}

app.get('/', async (c) => {
  const userId = c.get('userId')
  const all = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  // Surface the effective type (own override, else a tagged ancestor's, else path inference)
  // so the UI and the journal serializer share one resolved answer. `type` stays the raw
  // stored override. Every account is already in hand, so the tags come from these rows.
  const ctx = { ...(await loadAccountTypeRoots(userId)), tagged: tagsFrom(all) }
  const withType = all.map((a) => ({ ...a, resolvedType: resolveStoredOrInferredType(a, ctx) }))
  return c.json(withType)
})

// Does this resolved type describe money you hold or owe, as opposed to a category money
// moved through? Asked as the coarse bucket rather than as a list of the five, so Cash lands
// with Asset and Conversion with Equity because `toClassifierType` says so.
function isBalanceBearing(type: StoredAccountType | null): boolean {
  if (type === null) return false
  const bucket = toClassifierType(type)
  return bucket === 'asset' || bucket === 'liability' || bucket === 'equity'
}

// The same question as a set, for the SQL prefilter. Derived rather than written out: two
// lists that must agree are one list that will eventually not.
const BALANCE_BEARING_TYPES = new Set(STORED_ACCOUNT_TYPES.filter(isBalanceBearing))

// The default selection for GET /balances: everything whose RESOLVED type is balance-bearing,
// optionally plus everything the app has no type for at all. Expenses and income are excluded
// either way — they are categories, and the Categories tab owns them.
//
// Resolved, not path-inferred: a wallet at `储蓄:现金` tagged Cash is money you hold, and
// selecting by path root alone left it on no balances surface at all — visible only to a
// caller that passed `?types=cash`, which is the one query the bug report could not make from
// the UI. The stored override is the account's answer about itself; a view that asks the path
// instead is asking the wrong source.
function balanceBearingCondition(ctx: AccountTypeContext, includeUnfiled: boolean): SQL {
  const balanceBearing = typeFilterCondition(BALANCE_BEARING_TYPES, ctx)
  if (!includeUnfiled) return balanceBearing

  // Unfiled is what it always meant: the app has no answer for this account. No usable
  // override, no tagged ancestor to inherit one from, and no configured root to infer one
  // from. A path that *is* tagged, or sits under one that is, is whatever that says.
  const unfiled = required(
    and(noUsableOverrideCondition(), not(underAnyTypeSourceCondition(ctx))),
    'unfiled',
  )
  return required(or(balanceBearing, unfiled), 'balance-bearing selection')
}

// GET /api/accounts/balances[?types=cash,asset][?include=unfiled]
// Returns all asset, liability, and equity accounts with their per-currency balances and type.
// Membership is by RESOLVED type — own override, else a tagged ancestor's, else the root's — so
// an account is on this endpoint because of what it says it is, not because of where it sits.
// Balance = the sum of all posting amounts for that account, per currency.
// Accounts with no postings are included with an empty balances array.
//
// `type` and `resolvedType` mean exactly what they mean on GET /api/accounts: the raw stored
// override, and the effective resolved answer. This endpoint used to report
// a third thing under `type` — a coarse asset/liability/equity bucket — which made the same
// field name mean two different things depending on which route you called. Callers that want
// that bucket derive it with `toClassifierType(resolvedType)`, the same function the role
// classifier uses, so there is one implementation of the collapse rather than two.
app.get('/balances', async (c) => {
  const userId = c.get('userId')

  // Optional `?types=` filter. Both modes select by RESOLVED type (stored override wins over
  // inference); the filter only narrows which resolved types count. Absent, that is the five
  // balance-bearing ones; present, it is exactly what was asked for — which is how a caller
  // asks for Cash alone without also asking what a cash wallet's path looks like.
  const typesParam = c.req.query('types')
  // `?include=unfiled` adds the accounts the app has no type for: outside every configured
  // root AND carrying no override. Without this they appear on no surface at all — the
  // Accounts page groups them under "Unfiled" so a stray path is visibly stray rather than
  // silently missing. Tagging such an account is how it leaves that group.
  const includeParam = c.req.query('include')
  if (includeParam !== undefined && includeParam !== 'unfiled') {
    return fail(c, 'ACCOUNT_INCLUDE_INVALID', { value: includeParam })
  }
  const includeUnfiled = includeParam === 'unfiled'
  // The two are different selection modes — `types` picks by resolved type, `include` widens
  // the root-based default — so combining them would be ambiguous rather than additive.
  if (includeUnfiled && typesParam !== undefined) {
    return fail(c, 'ACCOUNT_INCLUDE_UNFILED_WITH_TYPES')
  }

  let typeFilter: Set<StoredAccountType> | null = null
  if (typesParam !== undefined) {
    const requested = typesParam.split(',').map((t) => t.trim())
    // An empty parameter is a caller mistake, not "everything" — a typo'd filter must not
    // silently widen to the whole ledger.
    if (requested.length === 0 || requested.some((t) => t === '')) {
      return fail(c, 'FIELD_EMPTY', { field: 'types' })
    }
    for (const t of requested) {
      if (!isStoredAccountType(t)) return fail(c, 'ACCOUNT_TYPE_INVALID', { type: t })
    }
    typeFilter = new Set(requested as StoredAccountType[])
  }

  const ctx = await loadAccountTypeContext(userId)

  const selection = and(
    eq(accounts.userId, userId),
    isNull(accounts.deletedAt),
    typeFilter
      ? typeFilterCondition(typeFilter, ctx)
      : balanceBearingCondition(ctx, includeUnfiled),
  )
  const rows = await db
    .select({
      id: accounts.id,
      path: accounts.path,
      name: accounts.name,
      storedType: accounts.type,
      defaultCurrency: accounts.defaultCurrency,
    })
    .from(accounts)
    .where(selection)
  // The amounts themselves, summed below in cents rather than by SQL `SUM`: the sum is the
  // same, and it no longer depends on the database adding decimals correctly (SQLite's
  // would add them as floats). Joined to the same selection so no id list is sent.
  const amounts = await db
    .select({ accountId: postings.accountId, currency: postings.currency, amount: postings.amount })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(isNull(postings.deletedAt), selection))

  // Collapse the flat rows into one entry per account with a balances array
  type Row = {
    id: string
    path: string
    name: string | null
    type: StoredAccountType | null
    resolvedType: StoredAccountType | null
    /** The account's own currency. A cash wallet holds exactly one, and the
     *  Companion reads this rather than guessing from the path leaf. */
    defaultCurrency: string | null
    balances: { currency: string; amount: string }[]
  }
  // The SQL above is a prefilter and is allowed to be over-inclusive; this is the verdict.
  // It runs in every mode, not just under `?types=`: the default selection reads the same
  // resolved type, so an account under the assets root that is tagged Expense is excluded
  // here rather than counted as money because of where it happens to sit.
  const keep = (resolvedType: StoredAccountType | null): boolean => {
    if (typeFilter) return resolvedType !== null && typeFilter.has(resolvedType)
    if (isBalanceBearing(resolvedType)) return true
    return includeUnfiled && resolvedType === null
  }

  // Each account's amounts by currency, in the order the currencies first appear.
  const byAccount = new Map<string, Map<string, string[]>>()
  for (const { accountId, currency, amount } of amounts) {
    const currencies = byAccount.get(accountId) ?? new Map<string, string[]>()
    byAccount.set(accountId, currencies)
    const list = currencies.get(currency) ?? []
    currencies.set(currency, list)
    list.push(amount)
  }

  const grouped: Row[] = []
  for (const row of rows) {
    const resolvedType = resolveStoredOrInferredType({ path: row.path, type: row.storedType }, ctx)
    if (!keep(resolvedType)) continue
    const currencies = byAccount.get(row.id) ?? new Map<string, string[]>()
    grouped.push({
      id: row.id,
      path: row.path,
      name: row.name,
      type: isStoredAccountType(row.storedType) ? row.storedType : null,
      resolvedType,
      defaultCurrency: row.defaultCurrency,
      balances: [...currencies].map(([currency, list]) => ({ currency, amount: money.sum(list) })),
    })
  }

  return c.json(grouped)
})

// GET /api/accounts/posting-counts
// Returns { accountId, count, lastActivity }[] — one row for every non-deleted account
// belonging to this user, including accounts that have never been posted to (count 0,
// lastActivity null). Counts only live postings on live transactions.
//
// lastActivity is the date of the most recent transaction touching the account, formatted
// YYYY-MM-DD to match GET /api/catch-up. It is a plain date, not a timestamp: callers render
// staleness in days, and a timestamp would only invite timezone drift.
app.get('/posting-counts', async (c) => {
  const userId = c.get('userId')
  // Left joins, so an account with no activity still gets a row. Both deletedAt filters sit in
  // the ON clauses rather than the WHERE — in the WHERE they would drop the unmatched rows and
  // collapse this back to an inner join. COUNT over transactions.id (not *) then counts only
  // the rows that actually joined, so a posting on a soft-deleted transaction is excluded.
  const rows = await db
    .select({
      accountId: accounts.id,
      count: sql<number>`COUNT(${transactions.id})::int`,
      lastActivity: sql<string | null>`to_char(MAX(${transactions.date})::date, 'YYYY-MM-DD')`,
    })
    .from(accounts)
    .leftJoin(postings, and(eq(postings.accountId, accounts.id), isNull(postings.deletedAt)))
    .leftJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt)),
    )
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .groupBy(accounts.id)
  return c.json(rows)
})

// GET /api/accounts/:id/balance?date=YYYY-MM-DD
// Returns the ledger balance for one account as of the end of the given date.
// Balance = the sum of postings in non-deleted transactions on or before the date, per currency.
app.get('/:id/balance', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.param('id')
  const dateParam = c.req.query('date')

  if (!dateParam) return fail(c, 'FIELD_REQUIRED', { field: 'date' })

  // Parse as a local date — treat the param as midnight UTC on that day.
  const asOf = new Date(`${dateParam}T23:59:59.999Z`)
  if (Number.isNaN(asOf.getTime())) return fail(c, 'FIELD_NOT_DATE', { field: 'date' })

  // Verify the account belongs to this user
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!account) return fail(c, 'ACCOUNT_NOT_FOUND')

  const rows = await db
    .select({ currency: postings.currency, amount: postings.amount })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(
      and(
        eq(postings.accountId, accountId),
        isNull(postings.deletedAt),
        isNull(transactions.deletedAt),
        lte(transactions.date, asOf),
      ),
    )

  // Summed in cents rather than by SQL `SUM`, as `/balances` does.
  const byCurrency = new Map<string, string[]>()
  for (const r of rows) {
    const list = byCurrency.get(r.currency) ?? []
    byCurrency.set(r.currency, list)
    list.push(r.amount)
  }

  return c.json({
    accountId,
    date: dateParam,
    balances: [...byCurrency].map(([currency, list]) => ({ currency, amount: money.sum(list) })),
  })
})

// Raw row shapes returned by the action-required SQL queries.
type ActionRequiredPairRow = { account_id: string; id: string }
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
// Returns { accountId, count }[] for all accounts that have at least one item needing
// attention. "Attention" unions two signals into one count: uncategorized transactions
// (a posting to the user's offset account) and malformed cross-currency spends that need
// repair (attached to the balance accounts they touch). Accounts with nothing to fix are
// omitted. Used by the sidebar dot and the account page badge.
app.get('/action-required-summary', async (c) => {
  const userId = c.get('userId')
  const { offsetAccountId } = await getActionRequiredSettings(userId)

  // accountId -> set of distinct tx ids needing attention (union avoids double-counting a
  // transaction that is both uncategorized and malformed on the same account).
  const byAccount = new Map<string, Set<string>>()
  const add = (accountId: string, txId: string) => {
    const set = byAccount.get(accountId) ?? new Set<string>()
    set.add(txId)
    byAccount.set(accountId, set)
  }

  const condition = actionRequiredCondition(offsetAccountId)
  if (condition) {
    const rows = await db.execute(sql`
      SELECT anchor.account_id, t.id
      FROM transactions t
      JOIN postings anchor ON anchor.transaction_id = t.id AND anchor.deleted_at IS NULL
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND ${condition}
    `)
    for (const r of rows as unknown as ActionRequiredPairRow[]) add(r.account_id, r.id)
  }

  const ctx = await loadHealContext(userId)
  const { byAccount: malformed } = await malformedFxSpendsByAccount(userId, ctx)
  for (const [accountId, txIds] of malformed) {
    for (const txId of txIds) add(accountId, txId)
  }

  return c.json([...byAccount].map(([accountId, txIds]) => ({ accountId, count: txIds.size })))
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
  if (!account) return fail(c, 'ACCOUNT_NOT_FOUND')

  const { offsetAccountId } = await getActionRequiredSettings(userId)

  // Uncategorized transactions touching this account.
  const ids = new Set<string>()
  const condition = actionRequiredCondition(offsetAccountId)
  if (condition) {
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
    for (const r of result as unknown as ActionRequiredIdRow[]) ids.add(r.id)
  }

  // Malformed cross-currency spends attached to this account — also need repair.
  const ctx = await loadHealContext(userId)
  const { byAccount } = await malformedFxSpendsByAccount(userId, ctx)
  const malformedTransactionIds = [...(byAccount.get(accountId) ?? new Set<string>())]
  for (const id of malformedTransactionIds) ids.add(id)

  const transactionIds = [...ids]
  return c.json({ count: transactionIds.length, transactionIds, malformedTransactionIds })
})

app.get('/:id', async (c) => {
  const userId = c.get('userId')
  const [found] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, c.req.param('id')),
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
      ),
    )
  if (!found) return fail(c, 'ACCOUNT_NOT_FOUND')
  return c.json(withResolvedTypes(found, await loadAccountTypeContext(userId)))
})

// Enriches an account row with the effective type and with what "Auto" would pick — the type
// it would have with no override of its own, and the tagged ancestor that answer came from, if
// any — so the settings UI can show "Auto (Expense, from 花钱)" beside an explicit override.
// Used by the single-account GET and PATCH so both return the same shape.
function withResolvedTypes<T extends { path: string; type: string | null }>(
  account: T,
  ctx: AccountTypeContext,
) {
  const auto = explainType({ path: account.path, type: null }, ctx)
  return {
    ...account,
    resolvedType: resolveStoredOrInferredType(account, ctx),
    inferredType: auto?.type ?? null,
    inheritedFrom: auto?.from === 'ancestor' ? auto.path : null,
  }
}

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
  const userId = c.get('userId')
  const parsed = await parseBody(c, NewAccount)
  if (!parsed.ok) return parsed.response
  const { path, ...overrides } = parsed.data

  // Receivable accounts are re-spawned at import, so the rename route refuses to move an
  // account into that namespace. Creating one there directly is the same hole by another door.
  if (isClearingAccountPath(path)) {
    return fail(c, 'RECEIVABLE_NOT_CREATABLE')
  }

  // Spread from the parsed body rather than the request's: the schema has already dropped
  // every key that is not one of the four, which is what keeps an `id` or a `userId` of
  // the caller's choosing out of the insert.
  const values = defined({ userId, path, ...overrides })

  const [created] = await db.insert(accounts).values(values).returning()
  return c.json(created, 201)
})

// POST /api/accounts/rename
// Rewrites an account path prefix `from` → `to` across the node itself and every
// descendant, in one transaction. A leaf rename is the degenerate case (exact match, no
// descendants); a parent rename cascades. Matching is on the materialized path, not id,
// so virtual grouping nodes (segments with no account row of their own) rename too.
//
// Postings are unaffected — they FK to the stable accounts.id.
//
// Rejects: receivable namespace (system-managed), an invalid target path, a target that
// would collide with an existing account (that's a merge, not a rename), and no-match.
// Both halves are required together, and the route has always said so as one failure
// naming both rather than two failures naming one each.
const bothRequired = as('FIELDS_REQUIRED', { fields: ['from', 'to'] })
const renamePart = z.string({ error: bothRequired }).min(1, { error: bothRequired })

const Rename = z.object({ from: renamePart, to: renamePart })

app.post('/rename', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, Rename)
  if (!parsed.ok) return parsed.response
  const { from, to } = parsed.data

  if (from === to) return fail(c, 'RENAME_TARGET_SAME_AS_SOURCE')
  if (!isValidPath(to)) return fail(c, 'RENAME_TARGET_INVALID')
  if (isClearingAccountPath(from)) return fail(c, 'RECEIVABLE_NOT_RENAMABLE')
  if (isClearingAccountPath(to)) return fail(c, 'RECEIVABLE_NOT_A_RENAME_TARGET')

  // Load all of this user's active accounts; match/collision-check in JS to avoid LIKE
  // wildcard hazards (`_`/`%` in a path) and keep anchoring exact. Per-user counts are small.
  const all = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))

  // Anchored prefix match: exactly `from`, or a descendant `from:...`. So renaming
  // `expenses:food` leaves `expenses:foodcourt` untouched.
  const matched = all.filter((a) => a.path === from || a.path.startsWith(`${from}:`))
  if (matched.length === 0) return fail(c, 'RENAME_NO_MATCH')

  const matchedIds = new Set(matched.map((a) => a.id))
  const existingPaths = new Set(all.filter((a) => !matchedIds.has(a.id)).map((a) => a.path))

  // Compute the rewrite and check each target against accounts outside the moved subtree.
  const rewrites = matched.map((a) => ({ id: a.id, newPath: `${to}${a.path.slice(from.length)}` }))
  const collision = rewrites.find((r) => existingPaths.has(r.newPath))
  if (collision) {
    return fail(c, 'RENAME_TARGET_EXISTS', { path: collision.newPath })
  }

  const updated = await db.transaction(async (tx) => {
    const out = []
    for (const r of rewrites) {
      const [row] = await tx
        .update(accounts)
        .set({ path: r.newPath })
        .where(and(eq(accounts.id, r.id), eq(accounts.userId, userId)))
        .returning()
      out.push(row)
    }
    return out
  })

  return c.json({ renamed: updated.length, accounts: updated })
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
  const userId = c.get('userId')
  const parsed = await parseBody(c, AccountPatch)
  if (!parsed.ok) return parsed.response

  const updates = defined(parsed.data)
  if (Object.keys(updates).length === 0) return fail(c, 'NO_FIELDS_TO_UPDATE')
  const [updated] = await db
    .update(accounts)
    .set(updates)
    .where(
      and(
        eq(accounts.id, c.req.param('id')),
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
      ),
    )
    .returning()
  if (!updated) return fail(c, 'ACCOUNT_NOT_FOUND')
  return c.json(withResolvedTypes(updated, await loadAccountTypeContext(userId)))
})

// DELETE /api/accounts/:id
//
// Soft-deletes an account, but only one nothing depends on. The route used to delete
// unconditionally, which made three quiet ways to lose data: an account with postings
// vanishes from every list while its entries keep pointing at it; a default offset /
// conversion / adjustments account leaves the pointer dangling and breaks the next import;
// and a receivable account is re-spawned by Fish Pie anyway. The UI guards all three, but a
// guard that only exists in the client is a guard the next client forgets.
//
// The subtree is deliberately *not* guarded: paths are materialized, so a parent row with
// live children simply reverts to a virtual grouping node in the tree. Nothing is lost.
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const [account] = await db
    .select({ path: accounts.path })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!account) return fail(c, 'ACCOUNT_NOT_FOUND')

  if (isClearingAccountPath(account.path)) {
    return fail(c, 'RECEIVABLE_NOT_DELETABLE')
  }

  // Postings on a soft-deleted transaction do not count — the entry is already gone, so the
  // account is free. Same rule the posting-counts listing uses, so the count the UI shows
  // and the count this refuses on are the same number.
  const [{ entries } = { entries: 0 }] = await db
    .select({ entries: sql<number>`COUNT(${transactions.id})::int` })
    .from(postings)
    .innerJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt)),
    )
    .where(and(eq(postings.accountId, id), isNull(postings.deletedAt)))
  if (entries > 0) {
    return fail(c, 'ACCOUNT_HAS_ENTRIES', { entries })
  }

  const [roles] = await db
    .select({
      offset: userSettings.defaultOffsetAccountId,
      conversion: userSettings.defaultConversionAccountId,
      adjustments: userSettings.defaultAdjustmentsAccountId,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  const held = [
    roles?.offset === id ? 'offset' : null,
    roles?.conversion === id ? 'conversion' : null,
    roles?.adjustments === id ? 'adjustments' : null,
  ].filter((r): r is string => r !== null)
  if (held.length > 0) {
    return fail(c, 'ACCOUNT_IS_A_DEFAULT', { roles: held })
  }

  await db
    .update(accounts)
    .set({ deletedAt: new Date() })
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  return c.body(null, 204)
})

export default app
