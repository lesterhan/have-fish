import { db } from '../db'
import { postings, accounts, transactions, userSettings } from '../db/schema'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import {
  detectMalformedFxSpend,
  planFxSpendRepair,
  type HealPosting,
  type HealSettings,
  type MalformedFinding,
} from './heal'

export type HealContext = {
  settings: HealSettings
  conversionAccountId: string | null
  conversionAccountPath: string | null
}

// Loads the per-user classification roots and the configured conversion account used as the
// repair target. Falls back to the schema defaults when the user has no settings row.
export async function loadHealContext(userId: string): Promise<HealContext> {
  const [s] = await db
    .select({
      expensesRootPath: userSettings.defaultExpensesRootPath,
      assetsRootPath: userSettings.defaultAssetsRootPath,
      liabilitiesRootPath: userSettings.defaultLiabilitiesRootPath,
      equityRootPath: userSettings.defaultEquityRootPath,
      conversionAccountId: userSettings.defaultConversionAccountId,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))

  const settings: HealSettings = {
    expensesRootPath: s?.expensesRootPath ?? 'expenses',
    assetsRootPath: s?.assetsRootPath ?? 'assets',
    liabilitiesRootPath: s?.liabilitiesRootPath ?? 'liabilities',
    equityRootPath: s?.equityRootPath ?? 'equity',
  }

  let conversionAccountPath: string | null = null
  if (s?.conversionAccountId) {
    const [acc] = await db
      .select({ path: accounts.path })
      .from(accounts)
      .where(and(eq(accounts.id, s.conversionAccountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    conversionAccountPath = acc?.path ?? null
  }

  return { settings, conversionAccountId: s?.conversionAccountId ?? null, conversionAccountPath }
}

// Fetches a transaction's live postings joined to their account paths, in the user's scope.
async function fetchPostingsWithPaths(userId: string, txIds: string[]): Promise<Map<string, HealPosting[]>> {
  if (txIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: postings.id,
      transactionId: postings.transactionId,
      accountId: postings.accountId,
      accountPath: accounts.path,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(
      inArray(postings.transactionId, txIds),
      isNull(postings.deletedAt),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ))

  const byTx = new Map<string, HealPosting[]>()
  for (const r of rows) {
    const list = byTx.get(r.transactionId) ?? []
    list.push({ id: r.id, accountId: r.accountId, accountPath: r.accountPath, amount: r.amount, currency: r.currency })
    byTx.set(r.transactionId, list)
  }
  return byTx
}

export type MalformedCandidate = {
  transaction: typeof transactions.$inferSelect
  postings: HealPosting[]
  finding: MalformedFinding
}

// Scans all of the user's active transactions for the malformed cross-currency-spend shape.
export async function findMalformedFxSpends(userId: string, ctx: HealContext): Promise<MalformedCandidate[]> {
  const txRows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))

  if (txRows.length === 0) return []
  const byTx = await fetchPostingsWithPaths(userId, txRows.map((t) => t.id))

  const candidates: MalformedCandidate[] = []
  for (const tx of txRows) {
    const ps = byTx.get(tx.id)
    if (!ps) continue
    const finding = detectMalformedFxSpend(ps, ctx.settings)
    if (finding) candidates.push({ transaction: tx, postings: ps, finding })
  }
  return candidates
}

// Maps malformed cross-currency spends to the balance (asset/liability) accounts they touch,
// so the per-account attention indicators can surface them on the pages the user actually
// visits. Returns the per-account tx-id sets plus the flat set of all malformed tx ids.
export async function malformedFxSpendsByAccount(
  userId: string,
  ctx: HealContext,
): Promise<{ byAccount: Map<string, Set<string>>; allTxIds: Set<string> }> {
  const candidates = await findMalformedFxSpends(userId, ctx)
  const { assetsRootPath, liabilitiesRootPath } = ctx.settings
  const isBalance = (path: string) =>
    path === assetsRootPath || path.startsWith(`${assetsRootPath}:`) ||
    path === liabilitiesRootPath || path.startsWith(`${liabilitiesRootPath}:`)

  const byAccount = new Map<string, Set<string>>()
  const allTxIds = new Set<string>()
  for (const c of candidates) {
    allTxIds.add(c.transaction.id)
    for (const p of c.postings) {
      if (!isBalance(p.accountPath)) continue
      const set = byAccount.get(p.accountId) ?? new Set<string>()
      set.add(c.transaction.id)
      byAccount.set(p.accountId, set)
    }
  }
  return { byAccount, allTxIds }
}

export type HealResult =
  | { ok: true; postings: HealPosting[] }
  | { ok: false; status: 404 | 400 | 409; error: string }

// Applies the repair to a single transaction. Pure account repoint — amounts never change,
// so the per-currency balance is preserved (re-validated defensively before commit).
export async function healFxSpend(userId: string, txId: string, ctx: HealContext): Promise<HealResult> {
  const [tx] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
  if (!tx) return { ok: false, status: 404, error: 'Transaction not found' }

  const ps = (await fetchPostingsWithPaths(userId, [txId])).get(txId) ?? []
  const finding = detectMalformedFxSpend(ps, ctx.settings)
  if (!finding) return { ok: false, status: 409, error: 'Transaction is not a malformed cross-currency spend' }

  if (!ctx.conversionAccountId) {
    return { ok: false, status: 400, error: 'No conversion account configured; set one in settings before healing' }
  }

  const repoints = planFxSpendRepair(finding, ctx.conversionAccountId)
  const newAccountById = new Map(repoints.map((r) => [r.postingId, r.toAccountId]))

  // Defensive balance check on the post-repair amounts (amounts are untouched, but guard anyway).
  const balances: Record<string, number> = {}
  for (const p of ps) balances[p.currency] = (balances[p.currency] ?? 0) + parseFloat(p.amount)
  for (const [currency, sum] of Object.entries(balances)) {
    if (Math.abs(sum) > 0.001) {
      return { ok: false, status: 409, error: `Repair would unbalance currency ${currency} (sum ${sum})` }
    }
  }

  await db.transaction(async (dbTx) => {
    for (const r of repoints) {
      await dbTx.update(postings).set({ accountId: r.toAccountId }).where(eq(postings.id, r.postingId))
    }
  })

  const updated = (await fetchPostingsWithPaths(userId, [txId])).get(txId) ?? []
  return { ok: true, postings: updated }
}
