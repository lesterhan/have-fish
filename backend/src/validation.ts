/**
 * Turning a request body into something the rest of the handler can trust.
 *
 * `c.req.json<T>()` is an unchecked cast: nothing inspects the body, and every line after
 * it is typed on a fiction. `await c.req.json()` is honest about being `any`, but a
 * handler that destructures it is no safer — just less misleading. Both crash on a body
 * that is not JSON at all. This module replaces the pattern with a schema, and maps what
 * the schema rejects onto the codes in `errors.ts` that the routes already answered with.
 *
 * ```ts
 * const Body = z.object({ accountId: z.uuid(), note: z.string().nullish() })
 *
 * app.post('/', async (c) => {
 *   const parsed = await parseBody(c, Body)
 *   if (!parsed.ok) return parsed.response
 *   const { accountId, note } = parsed.data   // genuinely a UUID, genuinely nullable
 * })
 * ```
 *
 * ## Two rules this module is built around
 *
 * **The wire contract does not move.** A body that was rejected with `FIELD_EMPTY`
 * yesterday is rejected with `FIELD_EMPTY` today. That is why the schemas below are
 * sometimes looser than they could be: where a route's own domain check already produces
 * a better code than a schema could (`ACCOUNT_PATH_INVALID`, `UNSUPPORTED_CURRENCY`), the
 * schema types the field as `unknown` and leaves the check where it is. Tightening those
 * is worth doing, but it is a change to the API and not this one.
 *
 * **A validator never writes a sentence.** Zod reports failures as English; this API
 * reports them as codes. `codeFor` below is the only translation, and `as`/`asField` are
 * how a schema overrides it for one check.
 */

import type { Context } from 'hono'
import { z } from 'zod'
import {
  type DetailArgs,
  type ErrorBody,
  type ErrorCode,
  type ErrorDetails,
  errorBody,
  failWith,
} from './errors'

/**
 * The codes whose whole detail is the offending field's name.
 *
 * These are the ones a schema can raise on its own, because knowing which key failed is
 * all they need. A code that carries anything else — `RENAME_TARGET_EXISTS` needs the
 * colliding path — belongs to the handler, not to the schema.
 */
export type FieldCode = {
  [C in ErrorCode]: C extends keyof ErrorDetails
    ? ErrorDetails[C] extends { field: string }
      ? { field: string } extends ErrorDetails[C]
        ? C
        : never
      : never
    : never
}[ErrorCode]

/**
 * Zod carries one string per issue — its message. This API carries a code and a typed
 * detail. So the message is the channel: `encode` packs an `ErrorBody` into it and
 * `decode` unpacks it, and the packed form never leaves this file.
 *
 * The alternative is a table from Zod's issue codes to ours, and that table alone cannot
 * say that a blank `name` is `FIELD_REQUIRED` in `parsers.ts` and `FIELD_EMPTY` in
 * `user-settings.ts`. Both are real; both are what those routes answer today. `codeFor`
 * below is that table, used when a check has no opinion of its own — `encode` is how a
 * check states one.
 */
const PACKED = '\u0000hf-error\u0000'

function encode(body: ErrorBody): string {
  return PACKED + JSON.stringify(body)
}

function decode(message: string): ErrorBody | null {
  if (!message.startsWith(PACKED)) return null
  return JSON.parse(message.slice(PACKED.length)) as ErrorBody
}

/**
 * Answer this check's failure with exactly this code.
 *
 * ```ts
 * postings: z.array(Posting).min(2, { error: as('TOO_FEW_POSTINGS') })
 * ```
 */
export function as<C extends ErrorCode>(code: C, ...detail: DetailArgs<C>): string {
  return encode(errorBody(code, ...detail) as ErrorBody)
}

/**
 * Answer this check's failure with this code, naming whichever field Zod was looking at.
 *
 * ```ts
 * fromDate: z.string().regex(ISO_DATE, { error: asField('FIELD_NOT_DATE') })
 * ```
 */
export function asField<C extends FieldCode>(code: C) {
  return (issue: { path?: PropertyKey[] | undefined }) => {
    // `FieldCode` is exactly the set of codes whose detail is `{ field: string }`, which
    // the mapped type above cannot prove to `errorBody`'s per-code signature.
    const detail = [{ field: fieldName(issue.path ?? []) }] as DetailArgs<C>
    return encode(errorBody(code, ...detail) as ErrorBody)
  }
}

/**
 * Answer this check's failure with this code, built from the value that failed it.
 *
 * `UNSUPPORTED_CURRENCY` and `ACCOUNT_TYPE_INVALID` both quote the offending value back to
 * the caller, and the only thing that knows what that value was is the check that rejected
 * it.
 *
 * ```ts
 * type: z.unknown().refine(isStoredAccountType, {
 *   error: asInput('ACCOUNT_TYPE_INVALID', (v) => ({ type: String(v) })),
 * })
 * ```
 */
export function asInput<C extends ErrorCode>(
  code: C,
  detail: (input: unknown) => DetailArgs<C>[0],
) {
  return (issue: { input?: unknown }) => {
    const args = [detail(issue.input)] as DetailArgs<C>
    return encode(errorBody(code, ...args) as ErrorBody)
  }
}

/**
 * An amount as a request can carry it: the string the web app sends, or the number a few
 * callers send, normalised to the string the numeric columns store.
 *
 * Absent and wrong-typed are told apart here rather than by `codeFor`, because a union
 * reports both as one issue and the mapper downstream only sees that the union failed.
 */
export const amountLike = z
  .union([z.string(), z.number()], {
    error: (issue: { input?: unknown; path?: PropertyKey[] | undefined }) => {
      const field = fieldName(issue.path ?? [])
      const code = issue.input === undefined ? 'FIELD_REQUIRED' : 'FIELD_INVALID'
      return encode(errorBody(code, { field }) as ErrorBody)
    },
  })
  .transform(String)

/**
 * A non-empty string that answers one code however it fails — absent, the wrong type, or
 * blank.
 *
 * Several routes already draw no distinction between those three: `parsers.ts` answers
 * `FIELD_REQUIRED` for all of them, `user-settings.ts` answers `FIELD_EMPTY`. Saying the
 * code once is what keeps this a rewrite of how the check is expressed rather than a
 * change to what it answers.
 */
export function text<C extends FieldCode>(code: C) {
  const error = asField(code)
  return z.string({ error }).trim().min(1, { error })
}

/**
 * The same object, with `undefined` taken out of its optional properties' types.
 *
 * Zod leaves an absent optional key out of its output rather than setting it to
 * `undefined`, and JSON has no `undefined` to send, so a parsed body never holds one.
 * Drizzle's insert and update types draw exactly that distinction under
 * `exactOptionalPropertyTypes` and refuse a key that might be present and undefined.
 * This states what parsing already guarantees, so a parsed body can be handed straight
 * to `.values()` or `.set()`.
 */
export function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return value as { [K in keyof T]: Exclude<T[K], undefined> }
}

/** `['postings', 2, 'currency']` → `postings[2].currency`, and `[]` → `body`. */
function fieldName(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'body'
  return path.reduce<string>(
    (acc, segment) =>
      typeof segment === 'number'
        ? `${acc}[${segment}]`
        : acc === ''
          ? String(segment)
          : `${acc}.${String(segment)}`,
    '',
  )
}

/**
 * What a Zod issue means in this API's vocabulary, for a check that did not say.
 *
 * Zod reports a missing key and a wrong-typed key as the same `invalid_type`; only the
 * input tells them apart, and only an error callback is handed the input. That is why
 * this is passed to `safeParse` rather than applied to the issues afterwards.
 */
function codeFor(issue: z.core.$ZodRawIssue): ErrorBody {
  const path = issue.path ?? []
  const field = fieldName(path)

  // A body that parsed as JSON but is not an object at all — an array, a number, a bare
  // string. There is no field to name, and the request is malformed in the same way a
  // body that is not JSON is malformed.
  if (issue.code === 'invalid_type' && path.length === 0) {
    return errorBody('INVALID_JSON_BODY') as ErrorBody
  }

  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return errorBody('FIELD_REQUIRED', { field }) as ErrorBody
      switch (issue.expected) {
        case 'string':
          return errorBody('FIELD_NOT_STRING', { field }) as ErrorBody
        case 'boolean':
          return errorBody('FIELD_NOT_BOOLEAN', { field }) as ErrorBody
        case 'int':
          return errorBody('FIELD_NOT_INTEGER', { field }) as ErrorBody
        case 'object':
        case 'record':
          return errorBody('FIELD_NOT_OBJECT', { field }) as ErrorBody
        default:
          return errorBody('FIELD_INVALID', { field }) as ErrorBody
      }
    }
    // `.min(1)` on a string or an array, and `.positive()` on a number, all land here.
    case 'too_small': {
      if (issue.origin === 'number') {
        return errorBody('FIELD_NOT_POSITIVE_NUMBER', { field }) as ErrorBody
      }
      return errorBody('FIELD_EMPTY', { field }) as ErrorBody
    }
    case 'invalid_format': {
      if (issue.format === 'uuid') return errorBody('FIELD_NOT_UUID', { field }) as ErrorBody
      return errorBody('FIELD_INVALID', { field }) as ErrorBody
    }
    // `z.enum` and `z.literal`.
    case 'invalid_value': {
      const allowed = (issue.values ?? []).map(String)
      return errorBody('FIELD_NOT_IN_SET', { field, allowed }) as ErrorBody
    }
    default:
      return errorBody('FIELD_INVALID', { field }) as ErrorBody
  }
}

/** The body a request carried, or the marker that it carried nothing parseable. */
const NOT_JSON = Symbol('not json')

async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => NOT_JSON)
}

export type Parsed<T> =
  | { ok: true; data: T; response?: never }
  | { ok: false; data?: never; response: Response }

/**
 * Read this request's body and parse it, or hand back the failure to return.
 *
 * ```ts
 * const parsed = await parseBody(c, Body)
 * if (!parsed.ok) return parsed.response
 * ```
 *
 * Only the first issue is reported. The wire has always carried one failure at a time —
 * `fail(c, code, detail)` has no room for a list — and a client that fixes the first
 * field and retries walks the rest, which is what the current hand-written guards already
 * do by returning on the first bad field.
 */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<Parsed<z.output<T>>> {
  const raw = await readJson(c)
  if (raw === NOT_JSON) {
    return { ok: false, response: failWith(c, errorBody('INVALID_JSON_BODY') as ErrorBody) }
  }

  const result = schema.safeParse(raw, { error: (issue) => encode(codeFor(issue)) })
  if (result.success) return { ok: true, data: result.data }

  const [issue] = result.error.issues
  // Every issue reaching here was written by `codeFor` or by an `as`/`asField` override,
  // so this decodes. The fallback is the floor under that claim rather than a path.
  const body = (issue && decode(issue.message)) ?? (errorBody('INVALID_JSON_BODY') as ErrorBody)
  return { ok: false, response: failWith(c, body) }
}
