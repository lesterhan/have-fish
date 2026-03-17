import { CsvDataToTransactions, IsValidDataRow, ParsedTransaction, ParseError } from "./types"

export const isValidDataRow: IsValidDataRow = (dataRow) => {
  return Boolean(
    dataRow['finishedon'] &&
    dataRow['targetamount'] &&
    dataRow['targetname'] &&
    dataRow['targetcurrency']
  )
}

export const toTransactions: CsvDataToTransactions = (csvDataRows) => {
  const transactions: ParsedTransaction[] = []
  const errors: ParseError[] = []

  csvDataRows.forEach((dataRow, index) => {
    if (isValidDataRow(dataRow)) {
      transactions.push(
        {
          date: new Date(dataRow.finishedon),
          amount: dataRow.targetamount,
          description: dataRow.targetname,
          currency: dataRow.targetcurrency,
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
