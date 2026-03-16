// Parses a raw CSV string exported from a bank into a normalized list of transactions.
//
// Banks format their CSVs differently (date formats, debit/credit split columns, header rows, etc.)
// The parse() function should handle these variations and surface invalid rows as errors
// rather than throwing, so the caller can decide what to do with partial results.

export type ParsedTransaction = {
  date: Date
  amount: string  // string of a number, negative = debit, positive = credit
  description: string
  currency?: string  // present if the CSV includes a currency column; otherwise the caller supplies a default
}

export type ParseError = {
  row: number
  reason: string
}

export type ParseResult = {
  transactions: ParsedTransaction[]
  errors: ParseError[]
}

export type CsvParser = (csv: string) => ParseResult

