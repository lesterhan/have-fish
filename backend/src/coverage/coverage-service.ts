// Coverage assertions and the views built on them: one account's strip, the month view, and
// the writes (assert, withdraw, reconcile, pin the config). The rules are pure and live
// beside this file: merging in `intervals`, the horizon and the config in `horizon`, months
// in `months`, reconcile in `reconcile`.

import { and, between, desc, eq, isNull, sql } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { accountCoverage, postings, transactions } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import {
  readCatchUpOverrides,
  readIntervals,
  resolveConfig,
  writeConfigOverride,
} from './config-service'
import {
  applyConfigChange,
  type ConfigChange,
  horizon,
  inferCycleFromIntervals,
  isComputable,
  mergeConfig,
  nextHorizon,
} from './horizon'
import { addDays, mergeCoverage } from './intervals'
import { loadCoverageContext, todayUtc } from './load-service'
import { classifyMonths } from './months'
import { coveredThrough, reconcileInterval } from './reconcile'

// The four ways an assertion can come to exist. Provenance only — a range covered by an
// 'empty' click counts exactly as much as one covered by an imported statement.
export const SOURCES = ['import', 'reconcile', 'manual', 'empty'] as const
export type CoverageSource = (typeof SOURCES)[number]

type CoverageRow = typeof accountCoverage.$inferSelect

const notFound = { ok: false, failure: errorBody('ACCOUNT_NOT_FOUND') } as const

// Coverage is an assertion about someone's ledger, so reading or writing one against an
// account you don't own must be impossible.
const owns = (userId: string, accountId: string) => accountsOwnedBy(userId, [accountId])

/**
 * One account's live assertions, newest first, alongside the coalesced spans, and everything
 * the coverage strip needs to draw `windowDays` day cells ending today.
 *
 * Both shapes are returned because they answer different questions: the merged spans are what
 * "covered through D" is read off, while the raw rows are the only thing carrying the ids that
 * a withdrawal needs — a merged span has no id to undo.
 */
export async function readCoverage(userId: string, accountId: string, windowDays: number) {
  if (!(await owns(userId, accountId))) return notFound

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
  const { config, override, inferred } = await resolveConfig(userId, accountId)
  const today = todayUtc()
  const windowFrom = addDays(today, -(windowDays - 1))

  // Distinct dates only — the strip draws one tick per day, not per transaction. Scoped to the
  // window so an account with a decade of history doesn't ship a decade of dates to draw 90
  // cells with.
  const txnDateRows = await db
    .selectDistinct({ date: transactions.date })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(postings.accountId, accountId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(postings.deletedAt),
        between(transactions.date, windowFrom, today),
      ),
    )

  return {
    ok: true,
    value: {
      accountId,
      intervals,
      assertions: rows,
      config,
      // The raw pins behind `config`, and what inference alone would have said. `config` is
      // post-merge and so cannot answer either question: which fields the user pinned, or what
      // "back to automatic" would restore them to.
      override,
      inferred,
      horizon: horizon(config, today),
      nextHorizon: nextHorizon(config, today),
      // The window the strip draws, and the days inside it that already have transactions.
      window: { from: windowFrom, to: today, days: windowDays },
      txnDates: txnDateRows.map((r) => r.date).sort(),
    },
  } as const
}

/**
 * Whether each calendar month is recorded, across every tracked account.
 *
 * Scope is every tracked account, not the accounts with transactions in the month — an
 * account whose statement was never imported has no transactions in the month *because* it
 * was never imported, so classifying against what shows up would read every neglected month
 * as complete.
 *
 * `assertedAccounts` is how many tracked accounts have ever had coverage asserted at all.
 * Zero means the coverage feature has never been used, in which case every month comes back
 * 'uncovered' — technically true and useless. A caller must say nothing about coverage rather
 * than tell a user who has never bootstrapped that none of their spending is recorded.
 */
export async function monthCoverage(userId: string, months: string[]) {
  const today = todayUtc()
  const { accounts, intervalsByAccount } = await loadCoverageContext(userId, today)

  const inputs = accounts.map((a) => ({
    accountId: a.accountId,
    path: a.path,
    name: a.name,
    intervals: intervalsByAccount.get(a.accountId) ?? [],
    dormant: a.dormant,
  }))

  return {
    today,
    assertedAccounts: inputs.filter((i) => i.intervals.length > 0).length,
    months: classifyMonths(inputs, months, today),
  }
}

/**
 * Assert that an account's ledger is complete for an inclusive date range.
 *
 * No reconciliation against existing rows — overlaps and duplicates are allowed to pile up
 * and are coalesced on read. Keeping writes dumb is what lets an import, a reconcile and a
 * manual assertion all land without any of them needing to know about the others.
 */
export async function assertCoverage(
  userId: string,
  assertion: {
    accountId: string
    fromDate: string
    throughDate: string
    source: CoverageSource
    note: string | null
  },
): Promise<Outcome<CoverageRow>> {
  if (!(await owns(userId, assertion.accountId))) return notFound
  const created = await db
    .insert(accountCoverage)
    .values({ userId, ...assertion })
    .returning()
  return { ok: true, value: returnedRow(created, 'insert account_coverage') }
}

/**
 * Withdraw an assertion. A soft delete, so the claim that was once made stays on the record
 * after the user takes it back. Withdrawing one that is already gone, or someone else's,
 * changes nothing.
 */
export async function withdrawCoverage(userId: string, id: string): Promise<void> {
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
}

/**
 * Pin part of an account's catch-up config by hand, over what inference guessed, and answer
 * with the config now in force.
 *
 * Stored under preferences.catchUp[accountId] rather than in a column on accounts, following
 * the same precedent as the other display preferences. Only the pins live there; the
 * effective config is always inference with these laid on top.
 */
export async function updateCoverageConfig(
  userId: string,
  accountId: string,
  change: ConfigChange,
) {
  if (!(await owns(userId, accountId))) return notFound

  const [overrides, intervals] = await Promise.all([
    readCatchUpOverrides(userId),
    readIntervals(userId, accountId),
  ])
  const override = applyConfigChange(overrides[accountId] ?? {}, change)
  const config = mergeConfig(inferCycleFromIntervals(intervals), override)
  if (!isComputable(config)) {
    return { ok: false, failure: errorBody('CYCLE_ACCOUNT_NEEDS_CYCLE_DAY') } as const
  }

  await writeConfigOverride(userId, accountId, override)

  const today = todayUtc()
  return {
    ok: true,
    value: {
      accountId,
      override,
      config,
      horizon: horizon(config, today),
      nextHorizon: nextHorizon(config, today),
    },
  } as const
}

/** What a reconcile answers: the interval it recorded, or why it recorded none. */
export type ReconcileResult =
  | { created: true; interval: CoverageRow }
  | { created: false; reason: 'already covered'; coveredThrough: string | null }

/** Record that a reconcile proved this account complete through `throughDate`. */
export async function reconcileCoverage(
  userId: string,
  accountId: string,
  throughDate: string,
): Promise<Outcome<ReconcileResult>> {
  if (!(await owns(userId, accountId))) return notFound

  const covered = coveredThrough(await readIntervals(userId, accountId))
  // The first transaction is only needed when there is no coverage to continue from.
  const first = covered === null ? await firstTransactionDate(userId, accountId) : null
  const interval = reconcileInterval(covered, throughDate, first)
  if (!interval) {
    return {
      ok: true,
      value: { created: false, reason: 'already covered', coveredThrough: covered },
    }
  }

  const created = await db
    .insert(accountCoverage)
    .values({ userId, accountId, ...interval, source: 'reconcile', note: null })
    .returning()
  return {
    ok: true,
    value: { created: true, interval: returnedRow(created, 'insert account_coverage') },
  }
}

async function firstTransactionDate(userId: string, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ first: sql<string | null>`MIN(${transactions.date})` })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(postings.accountId, accountId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(postings.deletedAt),
      ),
    )

  return row?.first ?? null
}
