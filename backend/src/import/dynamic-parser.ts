import type { ColumnMapping, ParsedTransaction, RegularParsedTransaction, TransferParsedTransaction, SameCurrencyTransferParsedTransaction, ParseError, ParseResult } from './types'

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
export function buildParser(columnMapping: ColumnMapping): (rows: Record<string, string>[]) => ParseResult {
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
      const date = new Date(rawDate)
      if (!rawDate || isNaN(date.getTime())) {
        errors.push({ row: rowNumber, reason: `invalid date: "${rawDate}"` })
        return
      }

      const description = columnMapping.description ? (row[columnMapping.description] ?? undefined) : undefined

      // --- currency transfer row ---
      if (hasTransferColumns) {
        const sourceCurrency = row[columnMapping.sourceCurrency!]?.trim()
        const targetCurrency = row[columnMapping.targetCurrency!]?.trim()

        if (sourceCurrency && targetCurrency && sourceCurrency !== targetCurrency) {
          const rawSourceAmount = row[columnMapping.sourceAmount!]
          const sourceAmountVal = parseFloat(rawSourceAmount)
          if (!rawSourceAmount || isNaN(sourceAmountVal)) {
            errors.push({ row: rowNumber, reason: `invalid sourceAmount: "${rawSourceAmount}"` })
            return
          }

          const rawTargetAmount = row[columnMapping.targetAmount!]
          const targetAmountVal = parseFloat(rawTargetAmount)
          if (!rawTargetAmount || isNaN(targetAmountVal)) {
            errors.push({ row: rowNumber, reason: `invalid targetAmount: "${rawTargetAmount}"` })
            return
          }

          const tx: TransferParsedTransaction = {
            isTransfer: true,
            date: date.toISOString(),
            description,
            sourceAmount: (-Math.abs(sourceAmountVal)).toFixed(2), // always negative (leaving source)
            sourceCurrency,
            targetAmount: Math.abs(targetAmountVal).toFixed(2),    // always positive (arriving at target)
            targetCurrency,
          }

          if (columnMapping.feeAmount) {
            const rawFee = row[columnMapping.feeAmount]
            const feeVal = parseFloat(rawFee)
            if (rawFee && !isNaN(feeVal)) {
              tx.feeAmount = Math.abs(feeVal).toFixed(2) // fee is always a positive expense amount
              tx.feeCurrency = columnMapping.feeCurrency ? (row[columnMapping.feeCurrency]?.trim() ?? sourceCurrency) : sourceCurrency
            }
          }

          transactions.push(tx)
          return
        }

        // Same-currency row with a non-zero fee → same-currency transfer (3 postings)
        if (sourceCurrency && targetCurrency && sourceCurrency === targetCurrency && columnMapping.feeAmount) {
          const rawFee = row[columnMapping.feeAmount]
          const feeVal = parseFloat(rawFee)
          if (rawFee && !isNaN(feeVal) && feeVal !== 0) {
            const rawTargetAmount = row[columnMapping.targetAmount!]
            const targetAmountVal = parseFloat(rawTargetAmount)
            if (!rawTargetAmount || isNaN(targetAmountVal)) {
              errors.push({ row: rowNumber, reason: `invalid targetAmount: "${rawTargetAmount}"` })
              return
            }
            const tx: SameCurrencyTransferParsedTransaction = {
              isTransfer: 'same-currency',
              date: date.toISOString(),
              description,
              amount: Math.abs(targetAmountVal).toFixed(2),
              feeAmount: Math.abs(feeVal).toFixed(2),
              currency: targetCurrency,
            }
            transactions.push(tx)
            return
          }
        }
      }

      // --- regular transaction row ---
      const rawAmount = row[columnMapping.amount]
      const amount = parseFloat(rawAmount)
      if (!rawAmount || isNaN(amount)) {
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
        date: date.toISOString(),
        amount: signedAmount.toFixed(2),
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
