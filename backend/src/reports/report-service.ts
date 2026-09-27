// The spending page's four reports. `spend-service` decides which legs are spending; the
// arithmetic is in `spending.ts`; rates come from the cache only, never the network, so a
// report never waits on frankfurter.app.

import { errorBody, type Outcome } from '../errors'
import { cachedRate } from '../fx/rate-service'
import { loadClassifySettings } from '../postings/classify-service'
import { hasExpenseAccountUnder, spendRows } from '../postings/spend-service'
import {
  convertedTotal,
  monthlyTotals,
  monthWindow,
  rateKey,
  ratesNeeded,
  summarizeSpending,
} from './spending'

/**
 * Total spend and per-category breakdown over optional inclusive dates, per currency. A
 * prefix that reaches no expense account is a caller mistake. It need not sit under the
 * configured expenses root: a tagged category at an atypical root is drillable like any
 * other, and the resolved type is what decides.
 */
export async function spendingSummary(
  userId: string,
  range: { from?: string | undefined; to?: string | undefined; prefix: string | null },
): Promise<Outcome<ReturnType<typeof summarizeSpending>>> {
  const settings = await loadClassifySettings(userId)
  const { prefix, from, to } = range
  if (prefix && !(await hasExpenseAccountUnder(userId, settings, prefix))) {
    return { ok: false, failure: errorBody('PREFIX_OUTSIDE_EXPENSES') }
  }

  const rows = await spendRows(userId, settings, {
    ...(prefix === null ? {} : { prefix }),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  })
  return { ok: true, value: summarizeSpending(rows, prefix) }
}

/** Spend for each of the last `months` calendar months, most recent last, empty ones included. */
export async function monthlySpend(userId: string, months: number) {
  const window = monthWindow(new Date(), months)
  const settings = await loadClassifySettings(userId)
  const rows = await spendRows(userId, settings, { from: window.from, to: window.to })
  return monthlyTotals(rows, window.keys)
}

/**
 * The (day, currency) rates converting the period's spending into `target` needs, and
 * whether each is already cached. The page fetches the missing ones through
 * `/api/fx-rates` before asking for the converted total.
 */
export async function spendingFxPairs(userId: string, from: string, to: string, target: string) {
  const settings = await loadClassifySettings(userId)
  const rows = await spendRows(userId, settings, { from, to })
  const pairs = await Promise.all(
    ratesNeeded(rows, target).map(async (need) => ({
      date: need.date,
      from: need.from,
      to: target,
      cached: (await cachedRate(need.date, need.from, target)) !== null,
    })),
  )
  return { pairs }
}

/**
 * The period's spending converted into `target` with cached rates, or a null total and how
 * many rates are missing.
 */
export async function spendingConverted(
  userId: string,
  from: string,
  to: string,
  target: string,
): Promise<{ total: string | null; missingCount: number }> {
  const settings = await loadClassifySettings(userId)
  const rows = await spendRows(userId, settings, { from, to })

  const rates = new Map<string, string>()
  let missingCount = 0
  for (const need of ratesNeeded(rows, target)) {
    const rate = await cachedRate(need.date, need.from, target)
    if (rate === null) missingCount++
    else rates.set(rateKey(need.date, need.from), rate)
  }
  if (missingCount > 0) return { total: null, missingCount }

  return { total: convertedTotal(rows, target, rates), missingCount: 0 }
}
