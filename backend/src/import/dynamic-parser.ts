import { calendarDateFromText } from '../calendar-date'
import * as money from '../money'
import type {
  ColumnMapping,
  ParsedTransaction,
  ParseError,
  ParseResult,
  RegularParsedTransaction,
  SameCurrencyTransferParsedTransaction,
  TransferParsedTransaction,
} from './types'

// Builds a row-parsing function from a stored ColumnMapping.
//
// The returned function accepts the output of parseCsv() — an array of objects
// with normalized header keys — and maps each row to a ParsedTransaction using
// the column names recorded in the mapping.
//
// When transfer columns are mapped and a row has sourceCurrency ≠ targetCurrency,
// the row is emitted as a TransferParsedTransaction instead of a regular one.
//
// Rows that fail validation are collected as ParseErrors.
//
// Every amount is read by `money.parse`, the same reading the ledger's numeric(12,2) column
// gives it, so what the preview shows is what gets written. Anything that is not a plain
// decimal is a row error: `parseFloat` read "-1,234.56" as -1 and stopped there (#447).
// Thousands separators are not guessed at, because "1,234.56" and "1.234,56" are the same
// amount in different locales; accepting them would be a setting on the parser.
export function buildParser(
  columnMapping: ColumnMapping,
): (rows: Record<string, string>[]) => ParseResult {
  // Pre-compute whether this mapping has transfer columns configured
  const hasTransferColumns = !!(
    columnMapping.sourceAmount &&
    columnMapping.sourceCurrency &&
    columnMapping.targetAmount &&
    columnMapping.targetCurrency
  )

  return function parseRows(rows: Record<string, string>[]): ParseResult {
    const transactions: ParsedTransaction[] = []
    const errors: ParseError[] = []

    rows.forEach((row, index) => {
      const rowNumber = index + 1

      // --- date ---
      const rawDate = row[columnMapping.date]
      // The calendar date the bank wrote, never shifted by this machine's time zone (#277,
      // `calendarDateFromText`). A column that is not in the row reads as no date, and the
      // error still reports what the row held.
      const date = calendarDateFromText(rawDate ?? '')
      if (!date) {
        errors.push({ row: rowNumber, reason: `invalid date: "${rawDate}"` })
        return
      }

      const description = columnMapping.description
        ? (row[columnMapping.description] ?? undefined)
        : undefined

      // --- currency transfer row ---
      if (hasTransferColumns) {
        const sourceCurrency = row[columnMapping.sourceCurrency!]?.trim()
        const targetCurrency = row[columnMapping.targetCurrency!]?.trim()

        if (sourceCurrency && targetCurrency && sourceCurrency !== targetCurrency) {
          const rawSourceAmount = row[columnMapping.sourceAmount!]
          const sourceCents = amountOf(rawSourceAmount)
          if (sourceCents === null) {
            errors.push({ row: rowNumber, reason: `invalid sourceAmount: "${rawSourceAmount}"` })
            return
          }

          const rawTargetAmount = row[columnMapping.targetAmount!]
          const targetCents = amountOf(rawTargetAmount)
          if (targetCents === null) {
            errors.push({ row: rowNumber, reason: `invalid targetAmount: "${rawTargetAmount}"` })
            return
          }

          const tx: TransferParsedTransaction = {
            isTransfer: true,
            date,
            description,
            sourceAmount: money.format(-Math.abs(sourceCents)), // always negative (leaving source)
            sourceCurrency,
            targetAmount: money.format(Math.abs(targetCents)), // always positive (arriving at target)
            targetCurrency,
          }

          if (columnMapping.feeAmount) {
            const rawFee = row[columnMapping.feeAmount]
            // A blank fee cell means no fee; anything else has to be an amount.
            if (rawFee?.trim()) {
              const feeCents = amountOf(rawFee)
              if (feeCents === null) {
                errors.push({ row: rowNumber, reason: `invalid feeAmount: "${rawFee}"` })
                return
              }
              tx.feeAmount = money.format(Math.abs(feeCents)) // fee is always a positive expense amount
              tx.feeCurrency = columnMapping.feeCurrency
                ? (row[columnMapping.feeCurrency]?.trim() ?? sourceCurrency)
                : sourceCurrency
            }
          }

          transactions.push(tx)
          return
        }

        // Same-currency row with a non-zero fee → same-currency transfer (3 postings)
        if (
          sourceCurrency &&
          targetCurrency &&
          sourceCurrency === targetCurrency &&
          columnMapping.feeAmount
        ) {
          const rawFee = row[columnMapping.feeAmount]
          // A blank or zero fee leaves this a regular row, below.
          const feeCents = rawFee?.trim() ? amountOf(rawFee) : 0
          if (feeCents === null) {
            errors.push({ row: rowNumber, reason: `invalid feeAmount: "${rawFee}"` })
            return
          }
          if (feeCents !== 0) {
            const rawTargetAmount = row[columnMapping.targetAmount!]
            const targetCents = amountOf(rawTargetAmount)
            if (targetCents === null) {
              errors.push({ row: rowNumber, reason: `invalid targetAmount: "${rawTargetAmount}"` })
              return
            }
            const tx: SameCurrencyTransferParsedTransaction = {
              isTransfer: 'same-currency',
              date,
              description,
              amount: money.format(Math.abs(targetCents)),
              feeAmount: money.format(Math.abs(feeCents)),
              currency: targetCurrency,
            }
            transactions.push(tx)
            return
          }
        }
      }

      // --- regular transaction row ---
      const rawAmount = row[columnMapping.amount]
      const amount = amountOf(rawAmount)
      if (amount === null) {
        errors.push({ row: rowNumber, reason: `invalid amount: "${rawAmount}"` })
        return
      }

      // Apply direction sign: if signColumn is configured and the row's value
      // matches signNegativeValue (case-insensitive), negate the amount.
      let signedAmount = amount
      if (columnMapping.signColumn && columnMapping.signNegativeValue) {
        const direction = row[columnMapping.signColumn]?.trim().toLowerCase()
        if (direction === columnMapping.signNegativeValue.toLowerCase()) {
          signedAmount = -Math.abs(amount)
        }
      }

      const tx: RegularParsedTransaction = {
        isTransfer: false,
        date,
        amount: money.format(signedAmount),
        description,
      }

      if (columnMapping.currency) {
        tx.currency = row[columnMapping.currency] ?? undefined
      }

      transactions.push(tx)
    })

    return { transactions, errors }
  }
}

// A cell as integer cents, or null when it is missing or is not an amount.
function amountOf(raw: string | undefined): number | null {
  return raw === undefined ? null : money.parse(raw)
}
