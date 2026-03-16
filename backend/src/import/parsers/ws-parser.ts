import { CsvParser, IsValidDataRow, ParsedTransaction, ParseError } from "./types"
import Papa from 'papaparse'

const isValidDataRow: IsValidDataRow = (dataRow) => {
  return Boolean(
    dataRow['date'] &&
    dataRow['transaction'] &&
    dataRow['description'] &&
    dataRow['amount'] &&
    dataRow['balance'] &&
    dataRow['currency']
  )
}

export const parse: CsvParser = (csv) => {
  const parsedResult = Papa.parse<Record<string, string>>(csv, { header: true })
  const transactions: ParsedTransaction[] = []
  const errors: ParseError[] = []

  parsedResult.data.forEach((dataRow, index) => {
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
