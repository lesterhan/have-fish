// Parses a raw CSV string exported from a bank into a normalized list of transactions.
//
// Banks format their CSVs differently (date formats, debit/credit split columns, header rows, etc.)
// The parse() function should handle these variations and surface invalid rows as errors
// rather than throwing, so the caller can decide what to do with partial results.

export type ParsedTransaction = {
  date: Date
  amount: string
  description: string
}

export type ParseError = {
  row: number
  reason: string
}

export type ParseResult = {
  transactions: ParsedTransaction[]
  errors: ParseError[]
}

// parse() accepts the full text content of a CSV file and returns all successfully
// parsed rows plus a list of rows that failed validation and why.
//
// Things to handle:
// - Skip header row(s)
// - Skip blank lines
// - Normalize date strings into Date objects (banks use many formats: MM/DD/YYYY, YYYY-MM-DD, etc.)
// - Handle banks that split debit and credit into two separate columns
// - Trim whitespace from all fields
// - Validate that required fields (date, amount) are present and well-formed
export function parse(csv: string): ParseResult {
  // TODO: implement
  return { transactions: [], errors: [] }
}
