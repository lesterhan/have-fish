// The spending page's arithmetic, over rows `spend-service` has already chosen: category
// totals, month buckets, and the conversion to one currency. Pure: `report-service.ts`
// loads the rows and the rates. Amounts are summed in integer cents.

import * as money from '../money'

/** One spend leg, as `spendRows` returns it. */
export type SpendLeg = { path: string; amount: string; currency: string; date: string }

/** Per-currency totals kept in cents, as the two-place strings the API has always answered. */
export function formatTotals(byCurrency: Record<string, number>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(byCurrency).map(([currency, cents]) => [currency, money.format(cents)]),
  )
}

/**
 * Total spend and a per-category breakdown, per currency.
 *
 * Without a prefix, a category is the first two path segments (`expenses:food`). With one,
 * it is one level below the prefix (`expenses:food` gives `expenses:food:restaurant`). Each
 * category's `childCount` is how many distinct direct children have spending in the rows,
 * so a count above zero means the category can be drilled into.
 */
export function summarizeSpending(rows: readonly SpendLeg[], prefix: string | null) {
  const totalByCurrency: Record<string, number> = {}
  const categoryMap: Record<string, Record<string, number>> = {}
  // Tracks distinct direct-child category paths per category, used to compute childCount
  const directChildSets: Record<string, Set<string>> = {}

  const prefixDepth = prefix ? prefix.split(':').length : 0

  for (const row of rows) {
    const amount = money.cents(row.amount)
    const { currency } = row
    const segments = row.path.split(':')

    // Determine the category bucket this row falls into
    const category = prefix
      ? segments.slice(0, prefixDepth + 1).join(':') // one level deeper than prefix
      : segments.length >= 2
        ? `${segments[0]}:${segments[1]}`
        : // A path with fewer than two segments is its own category; `row.path` says that
          // without indexing into a split whose length the compiler cannot see.
          row.path

    totalByCurrency[currency] = (totalByCurrency[currency] ?? 0) + amount
    const byCurrency = categoryMap[category] ?? {}
    byCurrency[currency] = (byCurrency[currency] ?? 0) + amount
    categoryMap[category] = byCurrency

    // If this path is deeper than the category, record the direct child
    const categoryDepth = category.split(':').length
    if (segments.length > categoryDepth) {
      const children = directChildSets[category] ?? new Set()
      children.add(segments.slice(0, categoryDepth + 1).join(':'))
      directChildSets[category] = children
    }
  }

  const categories = Object.entries(categoryMap).map(([category, byCurrency]) => ({
    category,
    total: formatTotals(byCurrency),
    childCount: directChildSets[category]?.size ?? 0,
  }))

  return { total: formatTotals(totalByCurrency), categories }
}

/**
 * The last `months` calendar months up to and including the one `now` falls in, in UTC:
 * the first and last day, and each month's `YYYY-MM`, oldest first.
 */
export function monthWindow(now: Date, months: number) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
    .toISOString()
    .slice(0, 10)
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10)
  const keys: string[] = []
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1 + i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return { from, to, keys }
}

/** Spend per month, per currency, with every month in `keys` present even when empty. */
export function monthlyTotals(rows: readonly SpendLeg[], keys: readonly string[]) {
  const monthMap: Record<string, Record<string, number>> = {}
  for (const key of keys) monthMap[key] = {}

  for (const row of rows) {
    const bucket = monthMap[row.date.slice(0, 7)]
    // Rows outside the requested range land on a month with no bucket; skip them.
    if (!bucket) continue
    bucket[row.currency] = (bucket[row.currency] ?? 0) + money.cents(row.amount)
  }

  return Object.entries(monthMap).map(([month, byCurrency]) => ({
    month,
    total: formatTotals(byCurrency),
  }))
}

/** A (day, currency) whose rate into the target currency a conversion needs. */
export type RateNeed = { date: string; from: string }

/** The key a rate is looked up by. */
export const rateKey = (date: string, currency: string) => `${date}:${currency}`

/**
 * The distinct (day, currency) pairs the rows need converted into `target`, in the order
 * they first appear. Rows already in `target` need nothing.
 */
export function ratesNeeded(rows: readonly SpendLeg[], target: string): RateNeed[] {
  const seen = new Set<string>()
  const needs: RateNeed[] = []
  for (const row of rows) {
    if (row.currency === target) continue
    const key = rateKey(row.date, row.currency)
    if (seen.has(key)) continue
    seen.add(key)
    needs.push({ date: row.date, from: row.currency })
  }
  return needs
}

/**
 * The rows' total in `target`, as a two-place string, or null when a rate is missing.
 *
 * In cents. An amount already in the target currency adds exactly; a converted one is a
 * float product of cents and rate, and the total is rounded to the cent once, at the end,
 * half away from zero as the ledger's own column rounds.
 */
export function convertedTotal(
  rows: readonly SpendLeg[],
  target: string,
  rates: ReadonlyMap<string, string>,
): string | null {
  let total = 0
  for (const row of rows) {
    const amount = money.cents(row.amount)
    if (row.currency === target) {
      total += amount
      continue
    }
    const rate = rates.get(rateKey(row.date, row.currency))
    if (rate === undefined) return null
    total += amount * parseFloat(rate)
  }
  const rounded = Math.sign(total) * Math.round(Math.abs(total)) + 0
  return money.format(rounded)
}
