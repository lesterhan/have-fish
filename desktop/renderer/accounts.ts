// The add-account pane's rules: the currency a kind starts at, and which field shows a refusal.

import { type AddableKind, classOf } from '@have-fish/core/account-kind'
import type { WireFailure } from '../shared/commands'
import { HOME_CURRENCY } from '../shared/currency'

/**
 * What the pane's fields hold. `currency` is `ANY` or a currency code; `start` is what's in it
 * today as typed, empty unless "How much is in it today?" is open.
 */
export type Adding = { name: string; kind: AddableKind; currency: string; start: string }

/** The currency field's value for "Any currency". */
export const ANY = ''

/** What the currency field starts at: cash holds any, the rest the home currency. */
export function startingCurrency(kind: AddableKind): string {
  return kind === 'cash' ? ANY : HOME_CURRENCY
}

/** The field's value as `account.add` takes it: null for any. */
export const lockOf = (currency: string): string | null => (currency === ANY ? null : currency)

/** The currency a starting balance is in: the account's, or the home currency for any. */
export const startCurrency = (currency: string | null): string =>
  currency === null || currency === ANY ? HOME_CURRENCY : currency

/** A card or a loan: its starting balance is what I owe. */
export const owes = (kind: AddableKind): boolean => classOf(kind) === 'liability'

export type AccountField = 'name' | 'start' | 'form'

/** A refusal about the name or the starting balance shows under it; anything else under the button. */
export function accountFieldOf(failure: WireFailure): AccountField {
  switch (failure.error) {
    case 'ACCOUNT_NAME_EMPTY':
    case 'ACCOUNT_NAME_TAKEN':
    case 'PATH_INVALID':
      return 'name'
    case 'AMOUNT_INVALID':
    case 'ACCOUNT_ALREADY_STARTED':
      return 'start'
    // The name is the account's path, once main has made it.
    case 'INPUT_MALFORMED':
    case 'DOCUMENT_MALFORMED':
      if (failure.detail.path === 'name' || failure.detail.path === 'path') return 'name'
      return failure.detail.path === 'start' || failure.detail.path === 'amount' ? 'start' : 'form'
    default:
      return 'form'
  }
}
