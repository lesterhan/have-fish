import { CsvDataToTransactions, IsValidDataRow, ParseResult } from "./parsers/types"
import { isValidDataRow, isValidDataRow as isValidWiseDataRow, toTransactions, toTransactions as toWiseTransactions } from "./parsers/wise-parser"
import { isValidDataRow as isValidWSDataRow, toTransactions as toWSTransactions } from "./parsers/ws-parser"
import Papa from 'papaparse'

type Parser = {
  isValidDataRow: IsValidDataRow,
  toTransactions: CsvDataToTransactions,
}

const defaultParsers: Parser[] = [
  { isValidDataRow: isValidWSDataRow, toTransactions: toWSTransactions },
  { isValidDataRow: isValidWiseDataRow, toTransactions: toWiseTransactions }
]

export function parse(csv: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(
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
  ).data
}

export function transactionsFromCsv(csv: string, parsers = defaultParsers): ParseResult {

  const csvDataRows = parse(csv)
  for (const parser of parsers) {
    if (parser.isValidDataRow(csvDataRows[0])) {
      return parser.toTransactions(csvDataRows)
    }
  }

  return { transactions: [], errors: [] }
}
