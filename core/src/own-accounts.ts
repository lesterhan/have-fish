// The accounts the app makes and keeps itself. Each path is written here and nowhere else.

import type { AccountKind } from './account-kind'

type Own = { path: string; kind: AccountKind }

/** Where a spend comes from before any account is chosen. */
export const WALLET = { path: 'assets:cash', kind: 'cash' } as const satisfies Own

/** Where a spend with no category goes. */
export const UNSORTED = { path: 'expenses:unsorted', kind: 'category' } as const satisfies Own

/** Where a starting balance comes from, as in hledger. */
export const OPENING = { path: 'equity:opening', kind: 'opening' } as const satisfies Own

/** What a conversion between two currencies passes through. */
export const CONVERSION = { path: 'equity:conversion', kind: 'conversion' } as const satisfies Own

/** The root and kind of an income source. */
export const INCOME = 'income' satisfies AccountKind
