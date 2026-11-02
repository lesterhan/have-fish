// The add-account pane's rules: the currency a kind starts at, and which field shows a refusal.

import type { AddableKind } from '@have-fish/core/account-kind'
import type { WireFailure } from '../shared/commands'
import { HOME_CURRENCY } from '../shared/currency'

/** What the pane's fields hold. `currency` is `ANY` or a currency code. */
export type Adding = { name: string; kind: AddableKind; currency: string }

/** The currency field's value for "Any currency". */
export const ANY = ''

/** What the currency field starts at: cash holds any, the rest the home currency. */
export function startingCurrency(kind: AddableKind): string {
  return kind === 'cash' ? ANY : HOME_CURRENCY
}

/** The field's value as `account.add` takes it: null for any. */
export const lockOf = (currency: string): string | null => (currency === ANY ? null : currency)

export type AccountField = 'name' | 'form'

/** A refusal about the name shows under it; anything else under the button. */
export function accountFieldOf(failure: WireFailure): AccountField {
  switch (failure.error) {
    case 'ACCOUNT_NAME_EMPTY':
    case 'ACCOUNT_NAME_TAKEN':
    case 'PATH_INVALID':
      return 'name'
    // The name is the account's path, once main has made it.
    case 'INPUT_MALFORMED':
    case 'DOCUMENT_MALFORMED':
      return failure.detail.path === 'name' || failure.detail.path === 'path' ? 'name' : 'form'
    default:
      return 'form'
  }
}
