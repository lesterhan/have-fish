// Loading the inputs the coverage derivation needs, once, for every reader that wants it.
//
// `routes/catch-up.ts` owned this querying outright until the accounts page and the status bar
// needed the same answer in a lighter form. Two readers deriving "is this account behind"
// from two queries is how the accounts page and the coach end up disagreeing about the same
// account on the same screen, so the queries and the assembly live here and the routes only
// choose what to project.

import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { accountCoverage, accounts, postings, transactions, userSettings } from '../db/schema'
import { isClearingAccountPath } from '../fish-pie-accounts'
import { resolveStoredOrInferredType, toClassifierType, DEFAULT_ROOTS } from '../postings/account-type'
import { addDays, type CoverageInterval } from './intervals'
import { inferCycleFromIntervals, mergeConfig, type CoverageConfigOverride } from './horizon'
import { assembleAccount, type CatchUpAccount, type CatchUpAccountInput } from './catch-up'

// Matches RATE_WINDOW_DAYS in catch-up.ts — the transaction query must reach back at least as
// far as the rate window, or the rate would be measured against missing rows.
const RATE_WINDOW_DAYS = 365

// UTC so the horizon doesn't shift under a traveller crossing timezones — the same convention
// the rest of the app stores dates with.
export function todayUtc(): string {
  return new Date().toISOString().substring(0, 10)
}

function idSet(value: unknown): Set<string> {
  return Array.isArray(value) ? new Set(value.filter((v): v is string => typeof v === 'string')) : new Set()
}

export type LoadOptions = {
  // Whether to query each account's full transaction span. It is an unbounded aggregate over
  // every posting the user has, and only bootstrap reads it — a caller that just wants
  // `state` and `coveredThrough` pays a full scan for two fields it drops. Off by default so
  // adding a reader is cheap and only the coach opts into the expensive part.
  spans?: boolean
}

// Every tracked account, assembled.
//
// Tracked means every non-deleted asset and liability account, minus any the user has hidden,
// flagged illiquid, or dismissed with `tracked: false`. Expense and income accounts, and Fish
// Pie clearing accounts, are derived from postings rather than imported, so there is nothing
// to catch up on and nothing they can be behind by.
export async function loadCoverageAccounts(
  userId: string,
  today: string,
  options: LoadOptions = {},
): Promise<CatchUpAccount[]> {
  const [settings] = await db
    .select({
      preferences: userSettings.preferences,
      assetsRootPath: userSettings.defaultAssetsRootPath,
      liabilitiesRootPath: userSettings.defaultLiabilitiesRootPath,
      equityRootPath: userSettings.defaultEquityRootPath,
      expensesRootPath: userSettings.defaultExpensesRootPath,
      incomeRootPath: userSettings.defaultIncomeRootPath,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))

  const roots = settings
    ? {
        assetsRootPath: settings.assetsRootPath,
        liabilitiesRootPath: settings.liabilitiesRootPath,
        equityRootPath: settings.equityRootPath,
        expensesRootPath: settings.expensesRootPath,
        incomeRootPath: settings.incomeRootPath,
      }
    : DEFAULT_ROOTS

  const preferences = (settings?.preferences ?? {}) as Record<string, unknown>
  const hidden = idSet(preferences.hiddenAccountIds)
  // The illiquid-account epic is still in the backlog, so nothing writes this key yet. Reading
  // it now means the coach respects the flag the day that feature lands, with no rework.
  const illiquid = idSet(preferences.illiquidAccountIds)
  const catchUpOverrides = (
    typeof preferences.catchUp === 'object' && preferences.catchUp !== null && !Array.isArray(preferences.catchUp)
      ? preferences.catchUp
      : {}
  ) as Record<string, CoverageConfigOverride>

  const allAccounts = await db
    .select({ id: accounts.id, path: accounts.path, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))

  const candidates = allAccounts.filter((a) => {
    if (hidden.has(a.id) || illiquid.has(a.id)) return false
    // Fish Pie clearing accounts are asset-typed but system-managed — their postings are
    // generated from group expenses and settlements, never imported from a statement, so
    // they can no more fall behind than an expense account can.
    if (isClearingAccountPath(a.path)) return false
    const resolved = resolveStoredOrInferredType(a, roots)
    if (!resolved) return false
    const type = toClassifierType(resolved)
    return type === 'asset' || type === 'liability'
  })

  // One query for every account's coverage, grouped in memory. Per-account queries would be a
  // round trip each, and the whole point of this loader is that it serves one page.
  const coverageRows = await db
    .select({
      accountId: accountCoverage.accountId,
      fromDate: accountCoverage.fromDate,
      throughDate: accountCoverage.throughDate,
    })
    .from(accountCoverage)
    .where(and(eq(accountCoverage.userId, userId), isNull(accountCoverage.deletedAt)))

  const intervalsByAccount = new Map<string, CoverageInterval[]>()
  for (const row of coverageRows) {
    const list = intervalsByAccount.get(row.accountId) ?? []
    list.push({ fromDate: row.fromDate, throughDate: row.throughDate })
    intervalsByAccount.set(row.accountId, list)
  }

  const configs = new Map(
    candidates.map((a) => {
      const intervals = intervalsByAccount.get(a.id) ?? []
      return [a.id, mergeConfig(inferCycleFromIntervals(intervals), catchUpOverrides[a.id] ?? {})]
    }),
  )

  const tracked = candidates.filter((a) => configs.get(a.id)!.tracked)

  // How far back the transaction query has to reach: far enough for the rate window, and far
  // enough to see into the oldest open gap. Computed from the coverage already in hand rather
  // than fixed, so a two-year gap still reports the transactions sitting inside it — but an
  // account covered up to yesterday doesn't drag a decade of rows along for the ride.
  let since = addDays(today, -(RATE_WINDOW_DAYS - 1))
  for (const account of tracked) {
    const intervals = intervalsByAccount.get(account.id)
    if (!intervals?.length) continue
    const leadingEdge = intervals.reduce((a, b) => (a.throughDate > b.throughDate ? a : b))
    const gapStart = addDays(leadingEdge.throughDate, 1)
    if (gapStart < since) since = gapStart
  }

  // Dates are stored as UTC timestamps; ::date truncates to the calendar day the ledger means.
  // DISTINCT on the transaction so a transfer with two legs in the same account counts once.
  const txnRows = await db
    .select({
      accountId: postings.accountId,
      date: sql<string>`to_char(${transactions.date}::date, 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(DISTINCT ${transactions.id})::int`,
    })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      gte(transactions.date, new Date(`${since}T00:00:00Z`)),
    ))
    .groupBy(postings.accountId, sql`${transactions.date}::date`)

  // The full history span, deliberately unbounded by the lookback above: bootstrap proposes
  // an account's whole existing ledger as its starting line, and that history routinely
  // predates any window a rate estimate would care about.
  const spanRows = options.spans
    ? await db
        .select({
          accountId: postings.accountId,
          first: sql<string>`to_char(MIN(${transactions.date})::date, 'YYYY-MM-DD')`,
          last: sql<string>`to_char(MAX(${transactions.date})::date, 'YYYY-MM-DD')`,
        })
        .from(postings)
        .innerJoin(transactions, eq(postings.transactionId, transactions.id))
        .where(and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          isNull(postings.deletedAt),
        ))
        .groupBy(postings.accountId)
    : []

  const spanByAccount = new Map(spanRows.map((r) => [r.accountId, { first: r.first, last: r.last }]))

  const countsByAccount = new Map<string, Record<string, number>>()
  for (const row of txnRows) {
    const counts = countsByAccount.get(row.accountId) ?? {}
    counts[row.date] = (counts[row.date] ?? 0) + row.count
    countsByAccount.set(row.accountId, counts)
  }

  return tracked.map((account) => {
    const input: CatchUpAccountInput = {
      accountId: account.id,
      path: account.path,
      name: account.name,
      config: configs.get(account.id)!,
      intervals: intervalsByAccount.get(account.id) ?? [],
      txnCountsByDate: countsByAccount.get(account.id) ?? {},
      firstTxnDate: spanByAccount.get(account.id)?.first ?? null,
      lastTxnDate: spanByAccount.get(account.id)?.last ?? null,
    }
    return assembleAccount(input, today)
  })
}
