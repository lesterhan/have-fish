// The result of mapping one CSV row to a transaction — a discriminated union.
// isTransfer: false — a standard single-currency row
export type RegularParsedTransaction = {
  isTransfer: false
  date: string        // ISO 8601 string
  amount: string      // signed numeric string, e.g. "-50.00" or "1200.00"
  description?: string
  currency?: string   // if absent, the import caller supplies a default
}

// isTransfer: true — a cross-currency transfer row (e.g. Wise CAD → GBP)
export type TransferParsedTransaction = {
  isTransfer: true
  date: string
  description?: string
  sourceAmount: string   // amount leaving the source account, e.g. "-200.00"
  sourceCurrency: string
  targetAmount: string   // amount arriving in the target account, e.g. "107.90"
  targetCurrency: string
  feeAmount?: string     // fee charged by the institution, e.g. "0.96"
  feeCurrency?: string
}

export type ParsedTransaction = RegularParsedTransaction | TransferParsedTransaction

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
  signColumn?: string | null        // the column whose value encodes direction
  signNegativeValue?: string | null // the value that means "negate the amount" (compared case-insensitively)
}
