import { errorBody, type ImportRowKind, type Outcome } from '../errors'
import type { PostingDraft } from '../ledger/validate'
import {
  buildCrossCurrencySpendPostings,
  buildFishPieCrossCurrencyPostings,
  buildFishPiePostings,
  buildFishPieSameCurrencyPostings,
  buildRegularPostings,
} from './postings'

// What an import commit writes, decided without a database.
//
// `commit-service.ts` loads what this needs (the Fish Pie accounts and share for each split
// row), and writes what it returns through the ledger service. Everything in between is
// here: which accounts each kind of row must name, and the legs each row becomes.
//
//   checkRows   the request's rows → the same rows, typed by kind, or the first one missing
//               an account it needs
//   planRows    typed rows + split context → one transaction per row, and a Fish Pie
//               expense for each split row

/** One row as the commit request carries it, before anything has checked it. */
export type ImportRowInput = {
  isTransfer?: boolean | 'cross-currency-spend' | 'same-currency' | undefined
  date: string
  description?: string | null | undefined
  amount?: string | undefined
  currency?: string | undefined
  sourceAmount?: string | undefined
  sourceCurrency?: string | undefined
  targetAmount?: string | undefined
  targetCurrency?: string | undefined
  feeAmount?: string | undefined
  feeCurrency?: string | undefined
  offsetAccountId?: string | undefined
  sourceAccountId?: string | undefined
  targetAccountId?: string | undefined
  conversionAccountId?: string | undefined
  expenseAccountId?: string | undefined
  feeAccountId?: string | undefined
}

/** A single-currency row: the source account against one offset account. */
export type RegularRow = {
  isTransfer: false
  date: string
  amount: string
  description?: string
  currency?: string
  offsetAccountId: string
  sourceAccountId?: string
}

/** Money moved between two currencies the user holds, bridged by the conversion account. */
export type TransferRow = {
  isTransfer: true
  date: string
  description?: string
  sourceAmount: string // negative (leaving source)
  sourceCurrency: string
  targetAmount: string // positive (arriving at target)
  targetCurrency: string
  feeAmount?: string // positive
  feeCurrency?: string
  sourceAccountId: string
  targetAccountId: string
  conversionAccountId: string
  feeAccountId: string
}

/** A purchase in a currency the user doesn't hold, converted on the fly. */
export type CrossCurrencySpendRow = {
  isTransfer: 'cross-currency-spend'
  date: string
  description?: string
  sourceAmount: string // negative, gross incl. fee (leaving source)
  sourceCurrency: string
  targetAmount: string // positive (the spend, in targetCurrency)
  targetCurrency: string
  feeAmount?: string // positive
  feeCurrency?: string
  sourceAccountId: string
  expenseAccountId: string // the spend account
  conversionAccountId: string
  feeAccountId?: string
}

/** Money received in one currency, less a fee. */
export type SameCurrencyTransferRow = {
  isTransfer: 'same-currency'
  date: string
  description?: string
  amount: string // net amount received (positive)
  feeAmount: string // fee charged (positive)
  currency: string
  targetAccountId: string // the account that received the money
  sourceAccountId: string // where the money came from
  feeAccountId: string
}

export type CommitRow = RegularRow | TransferRow | CrossCurrencySpendRow | SameCurrencyTransferRow

/**
 * Check that every row names the accounts its kind needs, in row order, and answer the
 * first that doesn't. A split row needs fewer: the Fish Pie legs replace its offset or
 * target account with the group's clearing account and the payer's expense account.
 *
 * `accountId` is the import's own account, which a regular row falls back to when it
 * names no source.
 */
export function checkRows(
  rows: readonly ImportRowInput[],
  options: { accountId: string | null | undefined; splitRows: ReadonlySet<number> },
): Outcome<CommitRow[]> {
  const { accountId, splitRows } = options
  const missing = (rowKind: ImportRowKind, field: string): Outcome<never> => ({
    ok: false,
    failure: errorBody('IMPORT_ROW_MISSING_ACCOUNT', { rowKind, field }),
  })

  for (const [rowIdx, t] of rows.entries()) {
    if (t.isTransfer === 'cross-currency-spend') {
      if (!t.sourceAccountId) return missing('cross-currency-spend', 'sourceAccountId')
      if (!t.expenseAccountId) return missing('cross-currency-spend', 'expenseAccountId')
      if (!t.conversionAccountId) return missing('cross-currency-spend', 'conversionAccountId')
      if (t.feeAmount && !t.feeAccountId) return missing('cross-currency-spend', 'feeAccountId')
    } else if (t.isTransfer === true) {
      if (!t.sourceAccountId) return missing('transfer', 'sourceAccountId')
      // A Fish Pie split routes through buildFishPieCrossCurrencyPostings, which splits the
      // target leg into the group + payer-expense accounts and never uses targetAccountId —
      // so a shared cross-currency spend has no target asset to require.
      if (!t.targetAccountId && !splitRows.has(rowIdx))
        return missing('transfer', 'targetAccountId')
      if (!t.conversionAccountId) return missing('transfer', 'conversionAccountId')
      if (!t.feeAccountId) return missing('transfer', 'feeAccountId')
    } else if (t.isTransfer === 'same-currency') {
      if (!t.targetAccountId) return missing('same-currency-transfer', 'targetAccountId')
      if (!t.sourceAccountId) return missing('same-currency-transfer', 'sourceAccountId')
      if (!t.feeAccountId) return missing('same-currency-transfer', 'feeAccountId')
    } else {
      // Fish Pie rows don't need offsetAccountId — the plan derives it from the group
      if (!t.offsetAccountId && !splitRows.has(rowIdx)) return missing('regular', 'offsetAccountId')
      if (!t.sourceAccountId && !accountId) return missing('regular', 'sourceAccountId')
    }
  }

  // The checks above establish every account field the row's type calls required. The
  // amounts and currencies are taken as the parser produced them, unchecked; a row that
  // arrives without one is #434.
  return { ok: true, value: rows as CommitRow[] }
}

/**
 * Every account id the request names, for the ownership check. It covers ids a Fish Pie
 * split then ignores, because an id that is not the caller's has no business in the
 * request at all.
 */
export function namedAccountIds(
  accountId: string | null | undefined,
  rows: readonly ImportRowInput[],
): string[] {
  return [
    accountId,
    ...rows.flatMap((t) => [
      t.offsetAccountId,
      t.sourceAccountId,
      t.targetAccountId,
      t.conversionAccountId,
      t.expenseAccountId,
      t.feeAccountId,
    ]),
  ].filter((id): id is string => !!id)
}

/**
 * What a split row needs from Fish Pie, loaded by the service: the group's clearing account
 * in the payer's ledger, and the payer's own expense account and share of the split.
 */
export type SplitContext = {
  groupId: string
  categoryId: string | null
  groupAccountId: string
  payerExpenseAccountId: string
  payerShareRatio: number
}

/**
 * Whether a row is planned differently when split with a Fish Pie group. A cross-currency
 * spend is not: its split is ignored and it is written as an ordinary spend.
 */
export function takesSplit(row: CommitRow): boolean {
  return row.isTransfer !== 'cross-currency-spend'
}

/** The Fish Pie expense a split row creates, linked to the row's transaction. */
export type PlannedGroupExpense = {
  groupId: string
  categoryId: string | null
  description: string
  amount: string
  currency: string
  date: string // YYYY-MM-DD
}

/** One row, planned: the transaction to write and, for a split row, its group expense. */
export type PlannedRow = {
  index: number
  transaction: { id: string; date: string; description: string | null; postings: PostingDraft[] }
  groupExpense?: PlannedGroupExpense
}

/**
 * The transaction each row becomes. Legs are built by `import/postings.ts`; which builder
 * a row gets depends on its kind and on whether it is split with a Fish Pie group.
 *
 * `newId` mints each transaction's id up front, because the builders stamp it on every leg.
 * Nothing here validates the legs: the ledger service does that as each is written, and a
 * refusal names the row by `index`.
 */
export function planRows(
  rows: readonly CommitRow[],
  context: {
    accountId: string | null | undefined
    defaultCurrency: string
    splits: ReadonlyMap<number, SplitContext>
    newId: () => string
  },
): PlannedRow[] {
  const { accountId, defaultCurrency, splits, newId } = context

  return rows.map((t, index) => {
    const transactionId = newId()
    const split = takesSplit(t) ? splits.get(index) : undefined
    const planned = (postings: PostingDraft[], groupExpense?: PlannedGroupExpense): PlannedRow => ({
      index,
      transaction: {
        id: transactionId,
        date: t.date,
        description: t.description ?? null,
        postings,
      },
      ...(groupExpense ? { groupExpense } : {}),
    })
    const expenseFor = (amount: string, currency: string): PlannedGroupExpense | undefined =>
      split && {
        groupId: split.groupId,
        categoryId: split.categoryId,
        description: t.description ?? '',
        amount,
        currency,
        date: new Date(t.date).toISOString().slice(0, 10),
      }

    if (t.isTransfer === 'cross-currency-spend') {
      // Cross-currency spend — a purchase in a currency the user doesn't hold, funded
      // from another-currency account via on-the-fly conversion. equity:conversions
      // bridges both sides; the spend lands in an expense account (never the bridge),
      // and no phantom asset balance is created. See buildCrossCurrencySpendPostings.
      const srcAmount = parseFloat(t.sourceAmount) // negative
      const feeVal = t.feeAmount ? parseFloat(t.feeAmount) : 0
      const conversionSrcAmount = (-(srcAmount + feeVal)).toFixed(2)

      return planned(
        buildCrossCurrencySpendPostings({
          transactionId,
          sourceAccountId: t.sourceAccountId,
          sourceAmount: t.sourceAmount,
          sourceCurrency: t.sourceCurrency,
          conversionAccountId: t.conversionAccountId,
          conversionSrcAmount,
          targetAmount: t.targetAmount,
          targetCurrency: t.targetCurrency,
          expenseAccountId: t.expenseAccountId,
          feeAmount: t.feeAmount,
          feeCurrency: t.feeCurrency ?? t.sourceCurrency,
          feeAccountId: t.feeAccountId,
        }),
      )
    }

    if (t.isTransfer === true) {
      // Cross-currency transfer — 4 or 5 postings (regular) or 5 or 6 (Fish Pie).
      //
      // Fish Pie variant: net target amount split between group clearing + payer expense.
      // Fee posting is untouched. targetAccountId is ignored (group/expense accounts replace it).
      //
      // Regular: equity:conversion bridges the two currencies:
      //   1. source account loses sourceAmount in sourceCurrency  (e.g. −200.00 CAD)
      //   2. equity:conversion gains the amount minus fee         (e.g. +199.04 CAD)
      //   3. fee expense account gains feeAmount                  (e.g.   +0.96 CAD)  ← omitted if no fee
      //   4. equity:conversion loses targetAmount in targetCurrency (e.g. −107.90 GBP)
      //   5. target account gains targetAmount in targetCurrency  (e.g. +107.90 GBP)
      //
      // Per-currency totals balance to zero.
      const srcAmount = parseFloat(t.sourceAmount) // negative
      const feeVal = t.feeAmount ? parseFloat(t.feeAmount) : 0 // positive or 0
      const tgtAmount = parseFloat(t.targetAmount) // positive
      const feeCurrency = t.feeCurrency ?? t.sourceCurrency
      const conversionSrcAmount = (-(srcAmount + feeVal)).toFixed(2)

      if (split) {
        return planned(
          buildFishPieCrossCurrencyPostings({
            transactionId,
            sourceAccountId: t.sourceAccountId,
            sourceAmount: t.sourceAmount,
            sourceCurrency: t.sourceCurrency,
            conversionAccountId: t.conversionAccountId,
            conversionSrcAmount,
            targetAmount: t.targetAmount,
            targetCurrency: t.targetCurrency,
            feeAmount: t.feeAmount,
            feeCurrency,
            feeAccountId: t.feeAccountId,
            groupAccountId: split.groupAccountId,
            expenseAccountId: split.payerExpenseAccountId,
            payerShareRatio: split.payerShareRatio,
          }),
          expenseFor(Math.abs(tgtAmount).toFixed(2), t.targetCurrency),
        )
      }

      const postingRows: PostingDraft[] = [
        { accountId: t.sourceAccountId, amount: t.sourceAmount, currency: t.sourceCurrency },
        {
          accountId: t.conversionAccountId,
          amount: conversionSrcAmount,
          currency: t.sourceCurrency,
        },
        {
          accountId: t.conversionAccountId,
          amount: (-tgtAmount).toFixed(2),
          currency: t.targetCurrency,
        },
        { accountId: t.targetAccountId, amount: t.targetAmount, currency: t.targetCurrency },
      ]
      if (t.feeAmount && feeVal !== 0) {
        postingRows.splice(2, 0, {
          accountId: t.feeAccountId,
          amount: t.feeAmount,
          currency: feeCurrency,
        })
      }
      return planned(postingRows)
    }

    if (t.isTransfer === 'same-currency') {
      // Same-currency IN transfer — 3 postings (regular) or 4 (Fish Pie).
      //
      // Fish Pie variant: net amount split between group clearing + payer expense.
      // Fee and source postings are untouched. targetAccountId is ignored.
      //
      // Regular:
      //   1. target account receives net amount (positive)
      //   2. fee expense account records the fee (positive)
      //   3. source account loses the gross amount (negative)
      if (split) {
        return planned(
          buildFishPieSameCurrencyPostings({
            transactionId,
            sourceAccountId: t.sourceAccountId,
            amount: t.amount,
            feeAmount: t.feeAmount,
            currency: t.currency,
            feeAccountId: t.feeAccountId,
            groupAccountId: split.groupAccountId,
            expenseAccountId: split.payerExpenseAccountId,
            payerShareRatio: split.payerShareRatio,
          }),
          expenseFor(Math.abs(parseFloat(t.amount)).toFixed(2), t.currency),
        )
      }

      const gross = (parseFloat(t.amount) + parseFloat(t.feeAmount)).toFixed(2)
      return planned([
        { accountId: t.targetAccountId, amount: t.amount, currency: t.currency },
        { accountId: t.feeAccountId, amount: t.feeAmount, currency: t.currency },
        { accountId: t.sourceAccountId, amount: `-${gross}`, currency: t.currency },
      ])
    }

    const currency = t.currency ?? defaultCurrency
    const sourceId = t.sourceAccountId ?? accountId
    // `checkRows` answered `IMPORT_ROW_MISSING_ACCOUNT` for exactly this, so reaching it
    // here means the two have drifted apart.
    if (!sourceId) throw new Error(`import row ${index} has no source account`)

    if (split) {
      // Fish Pie path — 3-posting import tx (BUG-004b fix).
      // The payer's share is recorded directly as a posting to their expense account,
      // so the group expense skips the payer's member transaction (skipPayerMemberTx).
      // offsetAccountId on the row is intentionally ignored; groupAccountId comes from the split.
      return planned(
        buildFishPiePostings({
          transactionId,
          sourceAccountId: sourceId,
          amount: t.amount,
          groupAccountId: split.groupAccountId,
          expenseAccountId: split.payerExpenseAccountId,
          payerShareRatio: split.payerShareRatio,
          currency,
        }),
        expenseFor(Math.abs(parseFloat(t.amount)).toFixed(2), currency),
      )
    }

    return planned(
      buildRegularPostings({
        transactionId,
        sourceAccountId: sourceId,
        amount: t.amount,
        offsetAccountId: t.offsetAccountId,
        currency,
      }),
    )
  })
}
