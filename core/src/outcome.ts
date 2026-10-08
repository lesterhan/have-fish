
export interface FailureDetails {
  TOO_FEW_POSTINGS: undefined
  DOCUMENT_MALFORMED: { path: string, issue: string }
  DATE_INVALID: { date: string }
  UNSUPPORTED_CURRENCY: { currency: string }
  AMOUNT_INVALID: { amount: string }
  POSTINGS_DO_NOT_BALANCE: { currency: string, cents: number }
  TOMBSTONE_HAS_POSTINGS: undefined
  PATH_INVALID: { path: string }
  PATH_ROOT_MISMATCH: { path: string, kind: string, expected: string }
}

export type FailureCode = keyof FailureDetails
export type Outcome<T> = { ok: true, value: T } | { ok: false, failure: { code: FailureCode, details: FailureDetails[FailureCode] } }

type DetailArgs<C extends FailureCode> = FailureDetails[C] extends undefined ? [] : [FailureDetails[C]]

export function failure<C extends FailureCode>(code: C, ...details: DetailArgs<C>): Outcome<never> {
  return { ok: false, failure: { code, details: details[0] } }
}

