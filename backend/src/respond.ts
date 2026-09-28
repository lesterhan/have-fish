/**
 * Answering a request with a failure: the one part of the failure vocabulary that needs a
 * request. The codes, their statuses and `errorBody` are in `errors.ts`, which imports nothing,
 * so a domain module can name a failure without reaching Hono (`layers.test.ts`).
 */

import type { Context } from 'hono'
import { type DetailArgs, ERROR_STATUS, type ErrorBody, type ErrorCode, errorBody } from './errors'

/**
 * Answer a request with a failure.
 *
 * ```ts
 * if (!account) return fail(c, 'ACCOUNT_NOT_FOUND')
 * if (!body.name) return fail(c, 'FIELD_REQUIRED', { field: 'name' })
 * ```
 */
export function fail<C extends ErrorCode>(c: Context, code: C, ...detail: DetailArgs<C>) {
  return failWith(c, errorBody(code, ...detail) as ErrorBody)
}

/**
 * Answer a request with a failure some other function already decided on: a service's
 * `Outcome`, or `parseBody`'s. `if (!r.ok) return failWith(c, r.failure)`.
 */
export function failWith(c: Context, body: ErrorBody) {
  return c.json(body, ERROR_STATUS[body.error])
}
