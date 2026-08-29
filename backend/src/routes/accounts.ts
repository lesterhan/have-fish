import { Hono } from 'hono'
import { db } from '../db'
import { accounts, postings, transactions, userSettings } from '../db/schema'
import { eq, isNull, and, like, or, not, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { loadHealContext, malformedFxSpendsByAccount } from '../postings/heal-service'
import { isClearingAccountPath } from '../fish-pie-accounts'
import { resolveAccountType, resolveStoredOrInferredType, isStoredAccountType, STORED_ACCOUNT_TYPES, DEFAULT_ROOTS, type AccountTypeRoots, type StoredAccountType } from '../postings/account-type'
import { isValidCurrency } from '../currencies'

const app = new Hono<{ Variables: AppVariables }>()

// Loads this user's configured account-type root paths, falling back to schema defaults when
// no settings row exists. Shared by endpoints that resolve account types.
async function loadAccountTypeRoots(userId: string): Promise<AccountTypeRoots> {
  const [s] = await db
    .select({
      assetsRootPath: userSettings.defaultAssetsRootPath,
      liabilitiesRootPath: userSettings.defaultLiabilitiesRootPath,
      equityRootPath: userSettings.defaultEquityRootPath,
      expensesRootPath: userSettings.defaultExpensesRootPath,
      incomeRootPath: userSettings.defaultIncomeRootPath,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return {
    assetsRootPath: s?.assetsRootPath ?? DEFAULT_ROOTS.assetsRootPath,
    liabilitiesRootPath: s?.liabilitiesRootPath ?? DEFAULT_ROOTS.liabilitiesRootPath,
    equityRootPath: s?.equityRootPath ?? DEFAULT_ROOTS.equityRootPath,
    expensesRootPath: s?.expensesRootPath ?? DEFAULT_ROOTS.expensesRootPath,
    incomeRootPath: s?.incomeRootPath ?? DEFAULT_ROOTS.incomeRootPath,
  }
}

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
  // Surface the effective type (stored override else path inference) so the UI and the
  // journal serializer share one resolved answer. `type` stays the raw stored override.
  const roots = await loadAccountTypeRoots(userId)
  const withType = all.map((a) => ({ ...a, resolvedType: resolveStoredOrInferredType(a, roots) }))
  return c.json(withType)
})

// SQL narrowing for `GET /balances?types=`. The authoritative verdict is still
// `resolveStoredOrInferredType` in the JS pass below; this only keeps the query from
// aggregating postings for the whole ledger (the LEFT JOIN + GROUP BY is the expensive
// part, and the Wallets tab hits it on every load). It is therefore allowed to be
// over-inclusive — the JS pass filters again — but must never be under-inclusive.
//
// An account matches a requested type either because it carries that STORED override, or
// because it carries no usable override and its PATH infers to it. `cash` and `conversion`
// are override-only, so they contribute no path branch at all — which is what makes
// `?types=cash` a cheap indexed lookup rather than a full scan.
function typeFilterCondition(types: Set<StoredAccountType>, roots: AccountTypeRoots) {
  const branches: SQL[] = [inArray(accounts.type, [...types])]

  // Roots whose inferred type was requested. Only the five inferable types have one.
  const inferableRoots: Partial<Record<StoredAccountType, string>> = {
    asset: roots.assetsRootPath,
    liability: roots.liabilitiesRootPath,
    equity: roots.equityRootPath,
    expense: roots.expensesRootPath,
    income: roots.incomeRootPath,
  }
  const wantedRoots = [...types].map((t) => inferableRoots[t]).filter((r): r is string => !!r)

  if (wantedRoots.length > 0) {
    // Inference applies only when the stored column holds nothing usable. A value outside
    // the valid set (shouldn't happen — validated on write) also falls back to inference,
    // so treat it like null here rather than letting the account drop out of the query.
    const noUsableOverride = or(
      isNull(accounts.type),
      not(inArray(accounts.type, [...STORED_ACCOUNT_TYPES])),
    )
    const underWantedRoot = wantedRoots.flatMap((root) => [
      eq(accounts.path, root),
      like(accounts.path, `${root}:%`),
    ])
    branches.push(and(noUsableOverride, or(...underWantedRoot))!)
  }

  return or(...branches)
}

// GET /api/accounts/balances[?types=cash,asset]
// Returns all asset, liability, and equity accounts with their per-currency balances and type.
// "Asset accounts"     = paths starting with defaultAssetsRootPath
// "Liability accounts" = paths starting with defaultLiabilitiesRootPath
// "Equity accounts"    = paths starting with defaultEquityRootPath
// Balance = SUM of all posting amounts for that account, grouped by currency.
// Accounts with no postings are included with an empty balances array.
//
// `type` and `resolvedType` mean exactly what they mean on GET /api/accounts: the raw stored
// override, and the effective stored-wins-else-inferred answer. This endpoint used to report
// a third thing under `type` — a coarse asset/liability/equity bucket — which made the same
// field name mean two different things depending on which route you called. Callers that want
// that bucket derive it with `toClassifierType(resolvedType)`, the same function the role
// classifier uses, so there is one implementation of the collapse rather than two.
app.get('/balances', async (c) => {
  const userId = c.get('userId')

  // Optional `?types=` filter. When absent, the endpoint keeps its original behaviour:
  // select by PATH ROOT (assets/liabilities/equity) and report the coarse three-way `type`.
  // When present, select by RESOLVED type instead (stored override wins over inference), so
  // a wallet tagged Cash under an atypically-named root — the very case the override exists
  // for — is found. The web dashboard and balances page pass no filter and are unaffected.
  const typesParam = c.req.query('types')
  let typeFilter: Set<StoredAccountType> | null = null
  if (typesParam !== undefined) {
    const requested = typesParam.split(',').map((t) => t.trim())
    // An empty parameter is a caller mistake, not "everything" — a typo'd filter must not
    // silently widen to the whole ledger.
    if (requested.length === 0 || requested.some((t) => t === '')) {
      return c.json({ error: 'types must not be empty' }, 400)
    }
    for (const t of requested) {
      if (!isStoredAccountType(t)) return c.json({ error: `invalid account type: ${t}` }, 400)
    }
    typeFilter = new Set(requested as StoredAccountType[])
  }

  const roots = await loadAccountTypeRoots(userId)
  const assetsRoot = roots.assetsRootPath
  const liabilitiesRoot = roots.liabilitiesRootPath
  const equityRoot = roots.equityRootPath

  // LEFT JOIN so accounts with no postings still appear (with null currency/balance)
  const rows = await db
    .select({
      id: accounts.id,
      path: accounts.path,
      name: accounts.name,
      storedType: accounts.type,
      currency: postings.currency,
      balance: sql<string>`SUM(${postings.amount})`,
    })
    .from(accounts)
    .leftJoin(postings, and(eq(postings.accountId, accounts.id), isNull(postings.deletedAt)))
    .where(and(
      eq(accounts.userId, userId),
      isNull(accounts.deletedAt),
      typeFilter
        ? typeFilterCondition(typeFilter, roots)
        : or(
            like(accounts.path, `${assetsRoot}:%`),
            like(accounts.path, `${liabilitiesRoot}:%`),
            like(accounts.path, `${equityRoot}:%`),
          ),
    ))
    .groupBy(accounts.id, accounts.path, accounts.name, accounts.type, postings.currency)

  // Collapse the flat rows into one entry per account with a balances array
  type Row = {
    id: string
    path: string
    name: string | null
    type: StoredAccountType | null
    resolvedType: StoredAccountType | null
    balances: { currency: string; amount: string }[]
  }
  const grouped = new Map<string, Row>()
  const excluded = new Set<string>()
  for (const row of rows) {
    if (excluded.has(row.id)) continue
    if (!grouped.has(row.id)) {
      const resolvedType = resolveStoredOrInferredType({ path: row.path, type: row.storedType }, roots)
      if (typeFilter && (resolvedType === null || !typeFilter.has(resolvedType))) {
        excluded.add(row.id)
        continue
      }
      grouped.set(row.id, {
        id: row.id,
        path: row.path,
        name: row.name,
        type: isStoredAccountType(row.storedType) ? row.storedType : null,
        resolvedType,
        balances: [],
      })
    }
    if (row.currency !== null && row.balance !== null) {
      grouped.get(row.id)!.balances.push({ currency: row.currency, amount: row.balance })
    }
  }

  return c.json([...grouped.values()])
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
    .leftJoin(transactions, and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt)))
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .groupBy(accounts.id)
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

  return c.json(
    [...byAccount].map(([accountId, txIds]) => ({ accountId, count: txIds.size })),
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
    .where(and(eq(accounts.id, c.req.param('id')), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!found) return c.json({ error: 'Not found' }, 404)
  const roots = await loadAccountTypeRoots(userId)
  return c.json(withResolvedTypes(found, roots))
})

// Enriches an account row with both the effective type (stored override else inference) and
// the pure inferred type, so the settings UI can show "Auto (inferred: X)" alongside an
// explicit override. Used by the single-account GET and PATCH so both return the same shape.
function withResolvedTypes<T extends { path: string; type: string | null }>(account: T, roots: AccountTypeRoots) {
  return {
    ...account,
    resolvedType: resolveStoredOrInferredType(account, roots),
    inferredType: resolveAccountType(account.path, roots),
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
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)

  const path = body.path
  if (typeof path !== 'string' || !isValidPath(path)) {
    return c.json({ error: 'invalid account path' }, 400)
  }
  // Receivable accounts are re-spawned at import, so the rename route refuses to move an
  // account into that namespace. Creating one there directly is the same hole by another door.
  if (isClearingAccountPath(path)) {
    return c.json({ error: 'receivable accounts are system-managed and cannot be created by hand' }, 400)
  }

  const values: {
    userId: string
    path: string
    name?: string | null
    defaultCurrency?: string | null
    type?: StoredAccountType | null
  } = { userId, path }

  if ('name' in body) {
    if (body.name !== null && typeof body.name !== 'string') {
      return c.json({ error: 'name must be a string or null' }, 400)
    }
    values.name = body.name
  }

  if ('defaultCurrency' in body) {
    const currency = readCurrency(body.defaultCurrency)
    if (!currency.ok) return c.json({ error: 'invalid currency' }, 400)
    values.defaultCurrency = currency.value
  }

  // Same rule as the update path: null means infer from the path, anything else must be one
  // of the seven hledger types.
  if ('type' in body) {
    if (body.type !== null && !isStoredAccountType(body.type)) {
      return c.json({ error: 'invalid account type' }, 400)
    }
    values.type = body.type as StoredAccountType | null
  }

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
app.post('/rename', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({}))
  const from = typeof body.from === 'string' ? body.from : ''
  const to = typeof body.to === 'string' ? body.to : ''

  if (!from || !to) return c.json({ error: '`from` and `to` are required' }, 400)
  if (from === to) return c.json({ error: '`from` and `to` are identical' }, 400)
  if (!isValidPath(to)) return c.json({ error: 'invalid target path' }, 400)
  if (isClearingAccountPath(from)) return c.json({ error: 'receivable accounts are system-managed and cannot be renamed' }, 400)
  if (isClearingAccountPath(to)) return c.json({ error: 'cannot rename into the receivable namespace' }, 400)

  // Load all of this user's active accounts; match/collision-check in JS to avoid LIKE
  // wildcard hazards (`_`/`%` in a path) and keep anchoring exact. Per-user counts are small.
  const all = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))

  // Anchored prefix match: exactly `from`, or a descendant `from:...`. So renaming
  // `expenses:food` leaves `expenses:foodcourt` untouched.
  const matched = all.filter((a) => a.path === from || a.path.startsWith(`${from}:`))
  if (matched.length === 0) return c.json({ error: 'no account matches the given path' }, 404)

  const matchedIds = new Set(matched.map((a) => a.id))
  const existingPaths = new Set(all.filter((a) => !matchedIds.has(a.id)).map((a) => a.path))

  // Compute the rewrite and check each target against accounts outside the moved subtree.
  const rewrites = matched.map((a) => ({ id: a.id, newPath: `${to}${a.path.slice(from.length)}` }))
  const collision = rewrites.find((r) => existingPaths.has(r.newPath))
  if (collision) {
    return c.json({ error: `target path already exists: ${collision.newPath} (merge, not rename)` }, 409)
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

app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const allowed = ['name'] as const
  const updates: Partial<typeof body> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  if ('defaultCurrency' in body) {
    const currency = readCurrency(body.defaultCurrency)
    if (!currency.ok) return c.json({ error: 'invalid currency' }, 400)
    updates.defaultCurrency = currency.value
  }
  // `type` is the hledger type override. null clears it (back to inference); any other value
  // must be one of the seven valid types. Reject anything else rather than storing garbage.
  if ('type' in body) {
    if (body.type !== null && !isStoredAccountType(body.type)) {
      return c.json({ error: 'invalid account type' }, 400)
    }
    updates.type = body.type
  }
  if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields to update' }, 400)
  const [updated] = await db
    .update(accounts)
    .set(updates)
    .where(and(eq(accounts.id, c.req.param('id')), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  const roots = await loadAccountTypeRoots(userId)
  return c.json(withResolvedTypes(updated, roots))
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
