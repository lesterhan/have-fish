import type { ColumnMapping, ParsedTransaction, ParseError, ParseResult } from './types'

// Builds a row-parsing function from a stored ColumnMapping.
//
// The returned function accepts the output of parseCsv() — an array of objects
// with normalized header keys — and maps each row to a ParsedTransaction using
// the column names recorded in the mapping.
//
// Rows that fail validation are collected as ParseErrors.
export function buildParser(columnMapping: ColumnMapping): (rows: Record<string, string>[]) => ParseResult {
  return function parseRows(rows: Record<string, string>[]): ParseResult {
    const transactions: ParsedTransaction[] = []
    const errors: ParseError[] = []

    rows.forEach((row, index) => {
      const rowNumber = index + 1

      // --- date ---
      const rawDate = row[columnMapping.date]
      const date = new Date(rawDate)
      if (!rawDate || isNaN(date.getTime())) {
        errors.push({ row: rowNumber, reason: `invalid date: "${rawDate}"` })
        return
      }

      // --- amount ---
      const rawAmount = row[columnMapping.amount]
      const amount = parseFloat(rawAmount)
      if (!rawAmount || isNaN(amount)) {
        errors.push({ row: rowNumber, reason: `invalid amount: "${rawAmount}"` })
        return
      }

      const tx: ParsedTransaction = {
        date: date.toISOString(),
        amount: amount.toFixed(2), // -19.9 fixed to '-19.90'
      }

      if (columnMapping.description) {
        tx.description = row[columnMapping.description] ?? undefined
      }

      if (columnMapping.currency) {
        tx.currency = row[columnMapping.currency] ?? undefined
      }

      transactions.push(tx)
    })

    return { transactions, errors }
  }
}
