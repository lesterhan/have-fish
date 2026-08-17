import type { Account, ExpenseGroup, ParsedTransaction } from '$lib/api'
import type { RowState } from './row-state'
import { rowMissingAccounts } from './import-helpers'

// The Confirm step's manifest — the last look before anything is written to the ledger.
//
// Per-destination totals are the point. They are the only thing that catches "everything
// landed in Uncategorized" *before* it is in the ledger; a bare row count cannot.

export type ManifestLine = {
  // Stable identity for the destination: an account id, or `group:<id>:<categoryId>`.
  key: string
  label: string
  count: number
  // Summed spend, or null when the rows behind this line span several currencies.
  total: number | null
  currency: string | null
  // Destination is the uncategorized fallback — the line worth a second look.
  isUncategorized: boolean
}

export type Manifest = {
  committedCount: number
  lines: ManifestLine[]
  skippedDuplicates: number
  skippedManual: number
  parseErrors: number
  rulesCreated: string[]
  accountsCreated: string[]
  // Min/max date across *committed* rows. A range starting at the CSV's first date would
  // open the transactions view on a screen whose top is rows that were skipped, which
  // defeats the point of landing there.
  dateRange: { from: string; to: string } | null
  // Rows that would block the commit, by index, so Confirm can link back to each.
  incomplete: number[]
}

export type ManifestContext = {
  accounts: Pick<Account, 'id' | 'path'>[]
  groups: Pick<ExpenseGroup, 'id' | 'name' | 'categories'>[]
  currencyAccounts: Record<string, string>
  fromAccountId: string
  isMultiCurrency: boolean
  defaultCurrency: string
  // The settings default offset account — where rows land when nothing claimed them.
  uncategorizedAccountId: string
  rulesCreated: string[]
  accountsCreated: string[]
}

// Where a row's money ends up, and how much of it. This mirrors the shape handleConfirm
// builds, so the manifest describes the commit rather than an idealized version of it.
function destinationOf(
  tx: ParsedTransaction,
  row: RowState,
  ctx: ManifestContext,
): { key: string; groupId: string | null; categoryId: string | null; accountId: string } {
  if (row.groupId) {
    return {
      key: `group:${row.groupId}:${row.categoryId ?? ''}`,
      groupId: row.groupId,
      categoryId: row.categoryId,
      accountId: '',
    }
  }
  const accountId =
    tx.isTransfer === true
      ? row.kind === 'spend'
        ? row.expenseAccountId
        : (ctx.currencyAccounts[tx.targetCurrency.toUpperCase()] ?? '')
      : tx.isTransfer === 'same-currency'
        ? ctx.isMultiCurrency
          ? (ctx.currencyAccounts[tx.currency.toUpperCase()] ?? '')
          : ctx.fromAccountId
        : row.offsetAccountId
  return { key: accountId || '(unassigned)', groupId: null, categoryId: null, accountId }
}

function amountOf(tx: ParsedTransaction, defaultCurrency: string): { amount: number; currency: string } {
  if (tx.isTransfer === true) {
    return { amount: Math.abs(parseFloat(tx.targetAmount)), currency: tx.targetCurrency }
  }
  if (tx.isTransfer === 'same-currency') {
    return { amount: Math.abs(parseFloat(tx.amount)), currency: tx.currency }
  }
  return { amount: Math.abs(parseFloat(tx.amount)), currency: tx.currency ?? defaultCurrency }
}

function labelFor(
  dest: ReturnType<typeof destinationOf>,
  ctx: ManifestContext,
): string {
  if (dest.groupId) {
    const group = ctx.groups.find((g) => g.id === dest.groupId)
    const category = dest.categoryId
      ? group?.categories.find((c) => c.id === dest.categoryId)
      : null
    const name = group?.name ?? 'Fish Pie group'
    return category ? `${name} · ${category.name}` : name
  }
  return ctx.accounts.find((a) => a.id === dest.accountId)?.path ?? 'No account assigned'
}

export function buildManifest(
  transactions: ParsedTransaction[],
  rowStates: RowState[],
  parseErrors: number,
  ctx: ManifestContext,
): Manifest {
  const byKey = new Map<string, ManifestLine & { currencies: Set<string> }>()
  let committedCount = 0
  let skippedDuplicates = 0
  let skippedManual = 0
  const incomplete: number[] = []
  const dates: string[] = []

  transactions.forEach((tx, i) => {
    const row = rowStates[i]
    if (!row) return
    if (row.skipped) {
      if (row.possibleDuplicate) skippedDuplicates++
      else skippedManual++
      return
    }

    committedCount++
    if (tx.date) dates.push(tx.date.slice(0, 10))
    if (rowMissingAccounts(tx, row)) incomplete.push(i)

    const dest = destinationOf(tx, row, ctx)
    const { amount, currency } = amountOf(tx, ctx.defaultCurrency)

    const existing = byKey.get(dest.key)
    if (existing) {
      existing.count++
      existing.total = existing.total === null ? null : existing.total + amount
      existing.currencies.add(currency)
    } else {
      byKey.set(dest.key, {
        key: dest.key,
        label: labelFor(dest, ctx),
        count: 1,
        total: amount,
        currency,
        isUncategorized:
          !dest.groupId && !!ctx.uncategorizedAccountId && dest.accountId === ctx.uncategorizedAccountId,
        currencies: new Set([currency]),
      })
    }
  })

  const lines: ManifestLine[] = [...byKey.values()]
    .map(({ currencies, ...line }) => ({
      ...line,
      // A destination fed by several currencies has no meaningful single total.
      total: currencies.size === 1 ? line.total : null,
      currency: currencies.size === 1 ? line.currency : null,
    }))
    // Biggest first — the line most likely to be wrong is the one with the most rows.
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  dates.sort()

  return {
    committedCount,
    lines,
    skippedDuplicates,
    skippedManual,
    parseErrors,
    rulesCreated: ctx.rulesCreated,
    accountsCreated: ctx.accountsCreated,
    dateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    incomplete,
  }
}
