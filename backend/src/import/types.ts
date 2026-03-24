// The result of mapping one CSV row to a transaction.
export type ParsedTransaction = {
  date: string        // ISO 8601 string
  amount: string      // signed numeric string, e.g. "-50.00" or "1200.00"
  description?: string
  currency?: string   // if absent, the import caller supplies a default
}

export type ParseError = {
  row: number   // 1-indexed row number in the original CSV
  reason: string
}

export type ParseResult = {
  transactions: ParsedTransaction[]
  errors: ParseError[]
}

// The stored column mapping: which normalized CSV column name maps to each
// transaction field. date and amount are required; the rest are optional.
// Transfer fields are only present when the parser's isMultiCurrency is true.
export type ColumnMapping = {
  date: string
  amount: string
  description?: string | null
  currency?: string | null
  // Multi-currency transfer fields
  sourceAmount?: string | null
  sourceCurrency?: string | null
  targetAmount?: string | null
  targetCurrency?: string | null
  feeAmount?: string | null
  feeCurrency?: string | null
}
