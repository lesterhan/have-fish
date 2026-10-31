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
  CLOCK_COUNTER_OVERFLOW: { wallMs: number }
  LEDGER_UNREADABLE: { path: string }
  LEDGER_TOO_NEW: { path: string; unknown: string[] }
  ACCOUNT_NOT_FOUND: { accountId: string }
  ACCOUNT_DELETED: { accountId: string }
  /** `transactions`: how many live transactions post to it. */
  ACCOUNT_IN_USE: { accountId: string; transactions: number }
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
