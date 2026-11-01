export interface FailureDetails {
  TOO_FEW_POSTINGS: undefined
  DOCUMENT_MALFORMED: { path: string; issue: string }
  DATE_INVALID: { date: string }
  UNSUPPORTED_CURRENCY: { currency: string }
  AMOUNT_INVALID: { amount: string }
  POSTINGS_DO_NOT_BALANCE: { currency: string; cents: number }
  TOMBSTONE_HAS_POSTINGS: undefined
  PATH_INVALID: { path: string }
  PATH_ROOT_MISMATCH: { path: string; kind: string; expected: string }
  VERSION_MALFORMED: { path: string; issue: string }
  CLOCK_DRIFT: { remoteWallMs: number; now: number }
  LEDGER_UNREADABLE: { path: string }
  LEDGER_TOO_NEW: { path: string; unknown: string[] }
  ACCOUNT_NOT_FOUND: { accountId: string }
  ACCOUNT_DELETED: { accountId: string }
  /** `transactions`: how many live transactions post to it. */
  ACCOUNT_IN_USE: { accountId: string; transactions: number }
  /** A local posting in another currency than the one its account is locked to. */
  ACCOUNT_CURRENCY_LOCKED: { accountId: string; currency: string; locked: string }
  /** A local lock on an account whose live postings carry `currencies` besides it. */
  ACCOUNT_HOLDS_OTHER_CURRENCIES: { accountId: string; currencies: string[] }
  /** A local write gave an existing document another origin. */
  ORIGIN_CHANGED: { id: string }
  /** A spend of zero or less. */
  AMOUNT_NOT_POSITIVE: { amount: string }
  /** A command's input doesn't fit its schema: Zod's first issue, as `DOCUMENT_MALFORMED`. */
  INPUT_MALFORMED: { path: string; issue: string }
  /** The window asked for a command main doesn't have. */
  COMMAND_UNKNOWN: { name: string }
  /** Main threw while running a command. The error is in main's log, never in the window. */
  UNEXPECTED: undefined
  /** An edit named a transaction this file doesn't hold. */
  TRANSACTION_NOT_FOUND: { id: string }
  /** An edit named a transaction that has been removed. */
  TRANSACTION_DELETED: { id: string }
  /** An edit of a spend's amount on a transaction that isn't one amount between two accounts. */
  TRANSACTION_NOT_SIMPLE: { id: string }
}

export type FailureCode = keyof FailureDetails

/** One member per code, so checking `code` narrows `details`. */
export type Failure = { [C in FailureCode]: { code: C; details: FailureDetails[C] } }[FailureCode]

export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: Failure }

type DetailArgs<C extends FailureCode> = FailureDetails[C] extends undefined
  ? []
  : [FailureDetails[C]]

export function failure<C extends FailureCode>(code: C, ...details: DetailArgs<C>): Outcome<never> {
  // tsc can't match a generic C to one member of Failure; the signature already ties details to code.
  return { ok: false, failure: { code, details: details[0] } as Failure }
}
