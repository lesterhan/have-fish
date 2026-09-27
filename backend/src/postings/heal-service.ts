import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { accounts, postings, transactions, userSettings } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import { imbalance } from '../ledger/validate'
import { inLedgerTransaction, repointPostings } from '../ledger/write-service'
import { loadAccountTypeContext } from './classify-service'
import {
  detectMalformedFxSpend,
  type HealPosting,
  type HealSettings,
  isBalanceLeg,
  type MalformedFinding,
  planFxSpendRepair,
  previewRepair,
} from './heal'

export type HealContext = {
  settings: HealSettings
  conversionAccountId: string | null
  conversionAccountPath: string | null
}

// Loads the per-user classification roots and the configured conversion account used as the
// repair target. Falls back to the schema defaults when the user has no settings row.
export async function loadHealContext(userId: string): Promise<HealContext> {
  const settings = await loadAccountTypeContext(userId)
  const [s] = await db
    .select({ conversionAccountId: userSettings.defaultConversionAccountId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))

  let conversionAccountPath: string | null = null
  if (s?.conversionAccountId) {
    const [acc] = await db
      .select({ path: accounts.path })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, s.conversionAccountId),
          eq(accounts.userId, userId),
          isNull(accounts.deletedAt),
        ),
      )
    conversionAccountPath = acc?.path ?? null
  }

  return { settings, conversionAccountId: s?.conversionAccountId ?? null, conversionAccountPath }
}

// Fetches a transaction's live postings joined to their account paths, in the user's scope.
async function fetchPostingsWithPaths(
  userId: string,
  txIds: string[],
): Promise<Map<string, HealPosting[]>> {
  if (txIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: postings.id,
      transactionId: postings.transactionId,
      accountId: postings.accountId,
      accountPath: accounts.path,
      accountType: accounts.type,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(
      and(
        inArray(postings.transactionId, txIds),
        isNull(postings.deletedAt),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    )

  const byTx = new Map<string, HealPosting[]>()
  for (const r of rows) {
    const list = byTx.get(r.transactionId) ?? []
    list.push({
      id: r.id,
      accountId: r.accountId,
      accountPath: r.accountPath,
      accountType: r.accountType,
      amount: r.amount,
      currency: r.currency,
    })
    byTx.set(r.transactionId, list)
  }
  return byTx
}

export type MalformedCandidate = {
  transaction: typeof transactions.$inferSelect
  postings: HealPosting[]
  finding: MalformedFinding
}

// Scans the user's active transactions for the malformed cross-currency-spend shape.
// Pre-filters to transactions whose postings span more than one currency — the only ones
// that can be a cross-currency spend — so the bulk of plain single-currency entries are
// never path-joined. This runs on every attention-indicator load, so the filter matters.
export async function findMalformedFxSpends(
  userId: string,
  ctx: HealContext,
): Promise<MalformedCandidate[]> {
  const multiCurrencyRows = await db.execute(sql`
    SELECT p.transaction_id
    FROM postings p
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.user_id = ${userId}
      AND t.deleted_at IS NULL
      AND p.deleted_at IS NULL
    GROUP BY p.transaction_id
    HAVING COUNT(DISTINCT p.currency) > 1
  `)
  const txIds = (multiCurrencyRows as unknown as { transaction_id: string }[]).map(
    (r) => r.transaction_id,
  )
  if (txIds.length === 0) return []

  const txRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        inArray(transactions.id, txIds),
      ),
    )

  if (txRows.length === 0) return []
  const byTx = await fetchPostingsWithPaths(userId, txIds)

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

  const byAccount = new Map<string, Set<string>>()
  const allTxIds = new Set<string>()
  for (const c of candidates) {
    allTxIds.add(c.transaction.id)
    for (const p of c.postings) {
      if (!isBalanceLeg(p, ctx.settings)) continue
      const set = byAccount.get(p.accountId) ?? new Set<string>()
      set.add(c.transaction.id)
      byAccount.set(p.accountId, set)
    }
  }
  return { byAccount, allTxIds }
}

/**
 * Every malformed cross-currency spend, each with its legs before and after the repair
 * `healFxSpend` would make. `canHeal` and `conversionAccountConfigured` are false when no
 * conversion account is set, since the repair needs one to point the bridge legs at.
 */
export async function malformedFxSpendReport(userId: string) {
  const ctx = await loadHealContext(userId)
  const candidates = await findMalformedFxSpends(userId, ctx)
  const canHeal = ctx.conversionAccountId !== null
  const conversion =
    ctx.conversionAccountId === null
      ? null
      : { id: ctx.conversionAccountId, path: ctx.conversionAccountPath }

  return {
    candidates: candidates.map(({ transaction, postings: ps, finding }) => ({
      transactionId: transaction.id,
      date: transaction.date,
      description: transaction.description,
      before: ps,
      after: previewRepair(ps, finding, conversion),
      canHeal,
    })),
    conversionAccountConfigured: canHeal,
  }
}

// Applies the repair to a single transaction. Pure account repoint — amounts never change,
// so the per-currency balance is preserved (re-validated defensively before commit).
export async function healFxSpend(userId: string, txId: string): Promise<Outcome<HealPosting[]>> {
  const ctx = await loadHealContext(userId)
  const [tx] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, txId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    )
  if (!tx) return { ok: false, failure: errorBody('TRANSACTION_NOT_FOUND') }

  const ps = (await fetchPostingsWithPaths(userId, [txId])).get(txId) ?? []
  const finding = detectMalformedFxSpend(ps, ctx.settings)
  if (!finding) return { ok: false, failure: errorBody('TRANSACTION_NOT_MALFORMED') }

  if (!ctx.conversionAccountId) {
    return { ok: false, failure: errorBody('CONVERSION_ACCOUNT_REQUIRED') }
  }

  const repoints = planFxSpendRepair(finding, ctx.conversionAccountId)

  // Defensive balance check on the post-repair amounts (amounts are untouched, but guard
  // anyway): the ledger's own rule, each currency exactly zero in cents.
  const off = imbalance(ps)
  if (off) {
    return {
      ok: false,
      failure: errorBody('HEAL_WOULD_UNBALANCE', { currency: off.currency, sum: off.cents / 100 }),
    }
  }

  const written = await inLedgerTransaction((dbTx) => repointPostings(dbTx, userId, repoints))
  if (!written.ok) return written

  const updated = (await fetchPostingsWithPaths(userId, [txId])).get(txId) ?? []
  return { ok: true, value: updated }
}
