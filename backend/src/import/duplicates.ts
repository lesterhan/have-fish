// When an imported row is probably something already in the ledger, decided without a
// database. `duplicates-service.ts` loads the candidate postings and calls these.
//
// A match is a posting on the same account, in the same currency, dated within a day of
// the row, whose amount is within 0.01 of the row's, ignoring sign. The currency matters:
// 8,400 JPY and 8,400 CAD are not the same purchase.
//
// That is a guess, kept for manual entries and rows imported before fingerprints. A row the
// preview keyed is also checked by fingerprint (`fingerprint.ts`), and a match there is
// certain.

/**
 * A row to check, already resolved to the account it will post to. `importKey` and
 * `importAccountId` (the row key from the preview, and the row's statement account as
 * commit will decide it) are there when the certain check can run.
 */
export type DuplicateCheckRow = {
  accountId: string
  date: string
  amount: string
  currency: string
  importKey?: string | undefined
  importAccountId?: string | undefined
}

/** A posting already in the ledger, with its transaction's date. */
export type ExistingPosting = {
  transactionId: string
  date: Date
  amount: string
  currency: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The rows to check, grouped by account. An empty `accountId` marks a transfer row, which
 * is not checked. Each row keeps its index, because the answer is positional.
 */
export function byAccount<R extends { accountId: string }>(
  rows: readonly R[],
): Map<string, { i: number; row: R }[]> {
  const grouped = new Map<string, { i: number; row: R }[]>()
  for (const [i, row] of rows.entries()) {
    const { accountId } = row
    if (!accountId) continue
    const forAccount = grouped.get(accountId) ?? []
    forAccount.push({ i, row })
    grouped.set(accountId, forAccount)
  }
  return grouped
}

/**
 * The dates to load candidates for: a day either side of the rows' earliest and latest,
 * to the end of the last day. In the server's local time zone, as it has always been.
 */
export function candidateWindow(dates: readonly string[]): { from: Date; to: Date } {
  const times = dates.map((d) => new Date(d).getTime())
  const from = new Date(Math.min(...times))
  const to = new Date(Math.max(...times))
  from.setDate(from.getDate() - 1)
  to.setDate(to.getDate() + 1)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

/** The first existing posting that looks like the same money as `row`, if any. */
export function findDuplicate(
  row: { date: string; amount: string; currency: string },
  existing: readonly ExistingPosting[],
): ExistingPosting | undefined {
  const txDate = new Date(row.date).getTime()
  const txAmount = parseFloat(row.amount)
  const txCurrency = row.currency.toUpperCase()

  return existing.find((e) => {
    const eDate = new Date(e.date).getTime()
    const eAmount = parseFloat(e.amount)
    return (
      e.currency.toUpperCase() === txCurrency &&
      Math.abs(eDate - txDate) <= DAY_MS &&
      Math.abs(Math.abs(eAmount) - Math.abs(txAmount)) <= 0.01
    )
  })
}
