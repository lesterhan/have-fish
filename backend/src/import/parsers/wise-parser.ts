import { CsvParser, IsValidDataRow, ParsedTransaction, ParseError } from "./types"
import Papa from 'papaparse'

const isValidDataRow: IsValidDataRow = (dataRow) => {
  return true
  /*return Boolean(
    dataRow['date'] &&
    dataRow['transaction'] &&
    dataRow['description'] &&
    dataRow['amount'] &&
    dataRow['balance'] &&
    dataRow['currency']
  )*/
}

export const parse: CsvParser = (csv) => {
  const parsedResult = Papa.parse<Record<string, string>>(
    csv,
    {
      header: true,
      transformHeader: (h) => {
        return h
          .toLowerCase()
          .replace(/\s/g, '')
          .replace(/\(.*\)/g, '')
      },
      dynamicTyping: false,
      skipEmptyLines: true,
    }
  )
  const transactions: ParsedTransaction[] = []
  const errors: ParseError[] = []

  parsedResult.data.forEach((dataRow, index) => {
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
