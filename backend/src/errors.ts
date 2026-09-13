/**
 * Every way a request can fail, as a code the client owns the words for.
 *
 * Route handlers used to write sentences: 294 hand-typed `error: '…'` strings across
 * `routes/`, four spellings of "no fields to update", two of "account not found", and one
 * that told the user which settings tab to visit — a route handler knowing the frontend's
 * navigation. Those sentences were also the API's only contract, so a copy edit was a
 * breaking change and the route tests asserted on prose.
 *
 * So the wire carries a code and the structured bits that vary:
 *
 * ```json
 * { "error": "FIELD_REQUIRED", "detail": { "field": "name" } }
 * ```
 *
 * and `frontend/src/lib/copy/errors.ts` turns that into a sentence. The backend holds no
 * user-facing prose at all; `copy.test.ts`'s backend half fails if one reappears here.
 *
 * Two things this registry buys beyond the words:
 *
 * - **One status per failure.** The status lives next to the code, so the same failure
 *   cannot answer 400 in one route and 404 in another. It did: `category not found in
 *   that group` was 404 in `rules.ts` and 400 in `fish-pie-expenses.ts` and `import.ts`.
 * - **Typed detail.** `ErrorDetails` below says which codes carry what, and `fail` makes
 *   a missing or misspelt field a compile error rather than `undefined` on screen.
 *
 * Adding a failure: add the code here with its status, add the detail shape if it varies,
 * and add the sentence to `copy/errors.ts`. The coverage test fails until you do the last
 * one, which is the point — a code with no sentence renders as itself.
 */

import type { Context } from 'hono'

/**
 * Code → HTTP status.
 *
 * The statuses are the ones these failures already returned; this file records them rather
 * than rationalising them. The single exception is `CATEGORY_NOT_IN_GROUP`, which had to
 * pick one and took 400, matching its two other call sites and the `CATEGORY_ARCHIVED`
 * check immediately beneath it in `rules.ts`.
 */
export const ERROR_STATUS = {
  UNAUTHORIZED: 401,

  // --- request shape ------------------------------------------------------------------
  INVALID_JSON_BODY: 400,
  FIELD_REQUIRED: 400,
  FIELDS_REQUIRED: 400,
  FIELD_EMPTY: 400,
  FIELD_NOT_STRING: 400,
  FIELD_NOT_BOOLEAN: 400,
  FIELD_NOT_OBJECT: 400,
  FIELD_NOT_UUID: 400,
  FIELD_NOT_DATE: 400,
  FIELD_NOT_MONTH: 400,
  FIELD_NOT_INTEGER: 400,
  FIELD_NOT_POSITIVE_INTEGER: 400,
  FIELD_NOT_POSITIVE_NUMBER: 400,
  FIELD_NOT_IN_SET: 400,
  FIELD_OUT_OF_RANGE: 400,
  NO_FIELDS_TO_UPDATE: 400,
  RANGE_OUT_OF_ORDER: 400,
  RANGE_TOO_LONG: 400,

  // --- currency ----------------------------------------------------------------------
  UNSUPPORTED_CURRENCY: 400,
  FX_RATE_UNAVAILABLE: 404,
  FX_RATE_UNAVAILABLE_FOR_DATE: 404,

  // --- accounts ----------------------------------------------------------------------
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNTS_NOT_FOUND: 404,
  ACCOUNT_NOT_YOURS: 400,
  ACCOUNT_PATH_INVALID: 400,
  ACCOUNT_TYPE_INVALID: 400,
  ACCOUNT_INCLUDE_INVALID: 400,
  ACCOUNT_INCLUDE_UNFILED_WITH_TYPES: 400,
  ACCOUNT_HAS_ENTRIES: 409,
  ACCOUNT_IS_A_DEFAULT: 409,
  SETTING_ACCOUNT_NOT_FOUND: 400,
  CYCLE_ACCOUNT_NEEDS_CYCLE_DAY: 400,

  // Receivable accounts are created and maintained by the Fish Pie settlement machinery.
  RECEIVABLE_NOT_CREATABLE: 400,
  RECEIVABLE_NOT_RENAMABLE: 400,
  RECEIVABLE_NOT_A_RENAME_TARGET: 400,
  RECEIVABLE_NOT_DELETABLE: 409,

  // --- renaming an account, or a whole subtree ----------------------------------------
  RENAME_TARGET_INVALID: 400,
  RENAME_TARGET_SAME_AS_SOURCE: 400,
  RENAME_TARGET_EXISTS: 409,
  RENAME_NO_MATCH: 404,

  // --- transactions and postings ------------------------------------------------------
  TRANSACTION_NOT_FOUND: 404,
  POSTING_NOT_FOUND: 404,
  TOO_FEW_POSTINGS: 400,
  POSTINGS_DO_NOT_BALANCE: 400,
  TRANSACTION_NOT_MALFORMED: 409,
  HEAL_WOULD_UNBALANCE: 409,

  // --- reports ------------------------------------------------------------------------
  PREFIX_OUTSIDE_EXPENSES: 400,

  // --- import and parsers -------------------------------------------------------------
  CSV_EMPTY: 422,
  NO_PARSER_MATCHED: 422,
  PARSER_NOT_FOUND: 404,
  PARSER_MAPPING_INCOMPLETE: 400,
  IMPORT_ROW_MISSING_ACCOUNT: 400,
  GROUP_SPLIT_MALFORMED: 400,
  GROUP_SPLIT_ROW_OUT_OF_RANGE: 400,

  // --- rules --------------------------------------------------------------------------
  RULE_NOT_FOUND: 404,
  RULE_TARGET_AMBIGUOUS: 400,
  RULE_TARGET_MISSING: 400,
  RULE_CATEGORY_WITHOUT_GROUP: 400,

  // --- Fish Pie: groups and membership -------------------------------------------------
  GROUP_NOT_FOUND: 404,
  GROUPS_NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  EXPENSE_NOT_FOUND: 404,
  SETTLEMENT_NOT_FOUND: 404,
  INVITE_NOT_FOUND: 404,
  /** The session outlived the account it belongs to. */
  USER_NOT_FOUND: 404,
  /** Only the person a settlement is owed to can confirm it. */
  ONLY_RECIPIENT_CAN_CONFIRM: 403,
  /** An expense belongs to whoever paid, and to whoever created the group. */
  NOT_THE_PAYER_OR_GROUP_CREATOR: 403,
  /** A settlement belongs to its two parties, and to whoever created the group. */
  NOT_A_PARTY_OR_GROUP_CREATOR: 403,
  /** An invitation belongs to whoever sent it, and to whoever created the group. */
  NOT_THE_INVITER_OR_GROUP_CREATOR: 403,
  /** The group itself belongs only to whoever created it. */
  NOT_THE_GROUP_CREATOR: 403,
  /** The caller is not in the group. */
  NOT_A_GROUP_MEMBER: 403,
  NOT_A_MEMBER_OF_ALL_GROUPS: 403,
  /** Someone the caller named in the body is not in the group. */
  NAMED_USER_NOT_A_MEMBER: 400,
  NO_USER_WITH_EMAIL: 404,
  ALREADY_A_MEMBER: 409,
  INVITE_ALREADY_PENDING: 409,

  // --- Fish Pie: categories and weights --------------------------------------------------
  CATEGORY_NOT_IN_GROUP: 400,
  CATEGORY_ARCHIVED: 400,
  WEIGHT_USER_NOT_A_MEMBER: 400,
  WEIGHT_DUPLICATE_USER: 400,
  WEIGHTS_INCOMPLETE: 400,

  // --- Fish Pie: expenses and settlements ------------------------------------------------
  PAYER_NOT_A_MEMBER: 400,
  PAYER_ACCOUNT_NOT_FOUND: 400,
  RECEIVER_ACCOUNT_NOT_FOUND: 400,
  ONLY_PAYER_CAN_SETTLE: 403,
  SETTLEMENT_SAME_USER: 400,
  SETTLEMENT_NATIVE_AMOUNT_MISMATCH: 400,
  SETTLEMENT_FX_RATE_REQUIRED: 400,
  SETTLEMENT_ALREADY_CONFIRMED: 409,
  SETTLEMENT_NEEDS_BATCH_CONFIRM: 409,
  CONVERSION_ACCOUNT_REQUIRED: 400,

  // --- merging groups ---------------------------------------------------------------------
  MERGE_NEEDS_TWO_GROUPS: 400,
  MERGE_MEMBERS_DIFFER: 400,
  MERGE_GROUPS_EMPTY: 400,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

/**
 * The structured values a message needs, for the codes whose message varies.
 *
 * `field` is the request field's own name — `accountId`, not "the account". These reach the
 * user only through `copy/errors.ts`, which decides whether to print them; a validation
 * failure naming a JSON key is a message for whoever is holding the API wrong.
 *
 * A code absent from this map takes no detail, and passing one is a compile error.
 */
export interface ErrorDetails {
  FIELD_REQUIRED: { field: string }
  FIELDS_REQUIRED: { fields: string[] }
  FIELD_EMPTY: { field: string }
  FIELD_NOT_STRING: { field: string }
  FIELD_NOT_BOOLEAN: { field: string }
  FIELD_NOT_OBJECT: { field: string }
  FIELD_NOT_UUID: { field: string }
  FIELD_NOT_DATE: { field: string }
  FIELD_NOT_MONTH: { field: string }
  FIELD_NOT_INTEGER: { field: string }
  FIELD_NOT_POSITIVE_INTEGER: { field: string }
  FIELD_NOT_POSITIVE_NUMBER: { field: string }
  FIELD_NOT_IN_SET: { field: string; allowed: readonly string[] }
  FIELD_OUT_OF_RANGE: { field: string; min: number; max: number }
  RANGE_OUT_OF_ORDER: { from: string; to: string }
  RANGE_TOO_LONG: { months: number }

  /** `currency` is absent when the request omitted it entirely. */
  UNSUPPORTED_CURRENCY: { currency?: string; index?: number }
  ACCOUNT_TYPE_INVALID: { type: string }
  ACCOUNT_INCLUDE_INVALID: { value: string }
  ACCOUNT_HAS_ENTRIES: { entries: number }
  /** The settings that point at the account: `offset`, `conversion`, `adjustments`. */
  ACCOUNT_IS_A_DEFAULT: { roles: readonly string[] }
  SETTING_ACCOUNT_NOT_FOUND: { field: string }
  RENAME_TARGET_EXISTS: { path: string }

  /** `index` is the position in a batch; absent for a single-transaction request. */
  TOO_FEW_POSTINGS: { index?: number }
  POSTINGS_DO_NOT_BALANCE: { currency: string; sum?: number; index?: number }
  HEAL_WOULD_UNBALANCE: { currency: string; sum: number }

  IMPORT_ROW_MISSING_ACCOUNT: { rowKind: ImportRowKind; field: string }
  GROUP_SPLIT_ROW_OUT_OF_RANGE: { rowIndex: number }
  GROUP_NOT_FOUND: { groupId?: string }
  NOT_A_GROUP_MEMBER: { groupId?: string }
  CATEGORY_NOT_IN_GROUP: { categoryId?: string; groupId?: string }
  CATEGORY_ARCHIVED: { categoryId?: string }
  NAMED_USER_NOT_A_MEMBER: { field: string }
  WEIGHT_USER_NOT_A_MEMBER: { userId: string }
  WEIGHT_DUPLICATE_USER: { userId: string }
}

/**
 * The detail argument list for one code: `[detail]` when it takes one, `[]` when it does not,
 * and `[detail?]` when every field of the detail is itself optional — `TOO_FEW_POSTINGS`
 * carries a batch index or nothing, and `fail(c, 'TOO_FEW_POSTINGS', {})` would be noise.
 */
type DetailArgs<C extends ErrorCode> = C extends keyof ErrorDetails
  ? Record<string, never> extends ErrorDetails[C]
    ? [detail?: ErrorDetails[C]]
    : [detail: ErrorDetails[C]]
  : []

/** The kinds of row the importer builds, which decide which accounts a row needs. */
export type ImportRowKind =
  | 'regular'
  | 'transfer'
  | 'same-currency-transfer'
  | 'cross-currency-spend'

/**
 * The body every failed request returns. The client reads `error` and never renders it raw.
 *
 * Mapped over the code rather than written as a plain conditional, so `ErrorBody` with no
 * argument is the discriminated union of all 87 bodies and a helper can hand one around
 * before it has a `Context` to send it with.
 */
export type ErrorBody<C extends ErrorCode = ErrorCode> = C extends ErrorCode
  ? { error: C } & (C extends keyof ErrorDetails
      ? Record<string, never> extends ErrorDetails[C]
        ? { detail?: ErrorDetails[C] }
        : { detail: ErrorDetails[C] }
      : { detail?: never })
  : never

/**
 * Build the body without sending it — for the handful of helpers that resolve access before
 * they hold a `Context`, and for `import.ts`, which reports a row's failure inside a result
 * rather than as a response.
 */
export function errorBody<C extends ErrorCode>(
  code: C,
  ...detail: DetailArgs<C>
): ErrorBody<C> {
  return (detail.length ? { error: code, detail: detail[0] } : { error: code }) as ErrorBody<C>
}

/**
 * Answer a request with a failure.
 *
 * ```ts
 * if (!account) return fail(c, 'ACCOUNT_NOT_FOUND')
 * if (!body.name) return fail(c, 'FIELD_REQUIRED', { field: 'name' })
 * ```
 */
export function fail<C extends ErrorCode>(
  c: Context,
  code: C,
  ...detail: DetailArgs<C>
) {
  return failWith(c, errorBody(code, ...detail) as ErrorBody)
}

/**
 * Answer a request with a failure some other function already decided on.
 *
 * `rules.ts` resolves a rule's target before it knows which route is asking, and
 * `heal-service.ts` is not a route at all; both return a body and let the handler send it.
 */
export function failWith(c: Context, body: ErrorBody) {
  return c.json(body, ERROR_STATUS[body.error])
}
