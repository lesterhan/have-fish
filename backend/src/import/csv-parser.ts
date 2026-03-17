import { ParseResult } from "./parsers/types"
import Papa from 'papaparse'

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

export function transactionsFromCsv(csv: string): ParseResult {
  // TODO: detect which parser to use
  return { transactions: [], errors: [] }
}
