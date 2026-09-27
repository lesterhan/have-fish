// Which accounts a balances view shows, and how their amounts add up. Pure: the balance
// service runs the query and hands the rows here.

import { errorBody, type Outcome } from '../errors'
import * as money from '../money'
import {
  isStoredAccountType,
  STORED_ACCOUNT_TYPES,
  type StoredAccountType,
  toClassifierType,
} from '../postings/account-type'

// Does this resolved type describe money you hold or owe, as opposed to a category money
// moved through? Asked as the coarse bucket rather than as a list of the five, so Cash lands
// with Asset and Conversion with Equity because `toClassifierType` says so.
export function isBalanceBearing(type: StoredAccountType | null): boolean {
  if (type === null) return false
  const bucket = toClassifierType(type)
  return bucket === 'asset' || bucket === 'liability' || bucket === 'equity'
}

// The same question as a set, for the SQL prefilter. Derived rather than written out: two
// lists that must agree are one list that will eventually not.
export const BALANCE_BEARING_TYPES: ReadonlySet<StoredAccountType> = new Set(
  STORED_ACCOUNT_TYPES.filter(isBalanceBearing),
)

/**
 * Which accounts `GET /api/accounts/balances` answers for, by RESOLVED type:
 *
 * - `types`: exactly the types asked for (`?types=cash,asset`). This is how a caller asks for
 *   Cash alone without also asking what a cash wallet's path looks like.
 * - `balanceBearing`: the default. Assets, liabilities and equity, Cash and Conversion
 *   included; with `includeUnfiled`, also every account the app has no type for at all.
 *   Expenses and income are left out either way: they are categories, and the Categories
 *   tab owns them.
 */
export type BalanceSelection =
  | { kind: 'types'; types: ReadonlySet<StoredAccountType> }
  | { kind: 'balanceBearing'; includeUnfiled: boolean }

/**
 * Read the selection from the query string, refusing what would be ambiguous or would
 * silently widen:
 *
 * - `include` other than `unfiled` is refused.
 * - `include=unfiled` with `types` is refused. `types` picks by resolved type and `include`
 *   widens the default, so combining them would be ambiguous rather than additive.
 * - An empty `types`, or an empty entry in it, is a caller mistake rather than "everything":
 *   a typo'd filter must not widen to the whole ledger.
 * - Each entry must be one of the seven stored types.
 */
export function readBalanceSelection(
  typesParam: string | undefined,
  includeParam: string | undefined,
): Outcome<BalanceSelection> {
  if (includeParam !== undefined && includeParam !== 'unfiled') {
    return { ok: false, failure: errorBody('ACCOUNT_INCLUDE_INVALID', { value: includeParam }) }
  }
  const includeUnfiled = includeParam === 'unfiled'
  if (includeUnfiled && typesParam !== undefined) {
    return { ok: false, failure: errorBody('ACCOUNT_INCLUDE_UNFILED_WITH_TYPES') }
  }
  if (typesParam === undefined) {
    return { ok: true, value: { kind: 'balanceBearing', includeUnfiled } }
  }

  const requested = typesParam.split(',').map((t) => t.trim())
  if (requested.some((t) => t === '')) {
    return { ok: false, failure: errorBody('FIELD_EMPTY', { field: 'types' }) }
  }
  const types = new Set<StoredAccountType>()
  for (const t of requested) {
    if (!isStoredAccountType(t)) {
      return { ok: false, failure: errorBody('ACCOUNT_TYPE_INVALID', { type: t }) }
    }
    types.add(t)
  }
  return { ok: true, value: { kind: 'types', types } }
}

/**
 * The verdict on one account. The SQL that selects candidates is a prefilter and may let
 * too much through; this is what decides. It runs in every mode: the default reads the
 * resolved type too, so an account under the assets root that is tagged Expense is left
 * out rather than counted as money because of where it happens to sit.
 */
export function selects(selection: BalanceSelection, resolvedType: StoredAccountType | null) {
  if (selection.kind === 'types') return resolvedType !== null && selection.types.has(resolvedType)
  if (isBalanceBearing(resolvedType)) return true
  return selection.includeUnfiled && resolvedType === null
}

/** One currency's balance. */
export type CurrencyBalance = { currency: string; amount: string }

/**
 * Amounts summed per currency, in the order each currency first appears. Summed in cents by
 * `money.sum` rather than by SQL `SUM`: the total is the same, and it no longer depends on
 * the database adding decimals correctly (SQLite's would add them as floats).
 */
export function sumByCurrency(
  rows: Iterable<{ currency: string; amount: string }>,
): CurrencyBalance[] {
  const byCurrency = new Map<string, string[]>()
  for (const { currency, amount } of rows) {
    const list = byCurrency.get(currency) ?? []
    byCurrency.set(currency, list)
    list.push(amount)
  }
  return [...byCurrency].map(([currency, list]) => ({ currency, amount: money.sum(list) }))
}
