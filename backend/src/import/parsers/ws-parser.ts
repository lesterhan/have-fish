import { CsvDataToTransactions, IsValidDataRow, ParsedTransaction, ParseError } from "./types"

export const isValidDataRow: IsValidDataRow = (dataRow) => {
  return Boolean(
    dataRow['date'] &&
    dataRow['transaction'] &&
    dataRow['description'] &&
    dataRow['amount'] &&
    dataRow['balance'] &&
    dataRow['currency']
  )
}

export const toTransactions: CsvDataToTransactions = (csvDataRows) => {
  const transactions: ParsedTransaction[] = []
  const errors: ParseError[] = []

  csvDataRows.forEach((dataRow, index) => {
    if (isValidDataRow(dataRow)) {
      transactions.push(
        {
          date: new Date(dataRow.date),
          amount: dataRow.amount,
          description: dataRow.description,
          currency: dataRow.currency,
        }
      )
    } else {
      errors.push(
        {
          row: index + 2,
          reason: 'Invalid row'
        }
      )
    }
  })


  return { transactions: transactions, errors: errors }
}
