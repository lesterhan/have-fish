import { ParseResult } from "./parsers/types"

export function parse(csv: string): ParseResult {
  // TODO: detect which parser to use
  return { transactions: [], errors: [] }
}
