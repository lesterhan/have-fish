import { z } from 'zod'
import { ACCOUNT_KINDS, rootOf } from './account-kind'
import { isValidPath } from './account-path'
import { isCalendarDate } from './calendar-date'
import type { Outcome } from './outcome'
import { failure } from './outcome'
import { validatePostings } from './postings'

export const PostingSchema = z.strictObject({
  accountId: z.uuid(),
  amount: z.string(),
  currency: z.string(),
})
export type PostingDoc = z.infer<typeof PostingSchema>

export const TransactionSchema = z.strictObject({
  type: z.literal('transaction'),
  id: z.uuid(),
  date: z.string(),
  description: z.string(),
  postings: z.array(PostingSchema),
  deletedAt: z.number().nullable(),
})
export type TransactionDoc = z.infer<typeof TransactionSchema>

export const AccountSchema = z.strictObject({
  type: z.literal('account'),
  id: z.uuid(),
  path: z.string(),
  kind: z.enum(ACCOUNT_KINDS),
  deletedAt: z.number().nullable(),
})
export type AccountDoc = z.infer<typeof AccountSchema>

export const DocumentSchema = z.discriminatedUnion('type', [TransactionSchema, AccountSchema])
export type LedgerDocument = z.infer<typeof DocumentSchema>

export function readShape(input: unknown): Outcome<LedgerDocument> {
  const result = DocumentSchema.safeParse(input)
  if (!result.success) {
    const firstIssue = result.error.issues[0]

    if (firstIssue === undefined) {
      return failure('DOCUMENT_MALFORMED', { path: 'Unknown', issue: 'Unknown' })
    }

    if (firstIssue.code === 'unrecognized_keys') {
      const errorPath = [...firstIssue.path, firstIssue.keys[0]]
      return failure('DOCUMENT_MALFORMED', { path: errorPath.join('.'), issue: firstIssue.code })
    }

    return failure('DOCUMENT_MALFORMED', {
      path: firstIssue.path.join('.'),
      issue: firstIssue.code,
    })
  }
  return {
    ok: true,
    value: result.data,
  }
}

function checkTransaction(doc: TransactionDoc): Outcome<TransactionDoc> {
  if (!isCalendarDate(doc.date)) {
    return failure('DATE_INVALID', { date: doc.date })
  }

  if (doc.deletedAt !== null) {
    if (doc.postings.length > 0) {
      return failure('TOMBSTONE_HAS_POSTINGS')
    }
  } else {
    const postingsCheck = validatePostings(doc.postings)
    if (!postingsCheck.ok) return postingsCheck
  }
  return { ok: true, value: doc }
}

function checkAccount(doc: AccountDoc): Outcome<AccountDoc> {
  if (!isValidPath(doc.path)) {
    return failure('PATH_INVALID', { path: doc.path })
  }

  const [root] = doc.path.split(':')
  const expected = rootOf(doc.kind)

  if (expected !== root) {
    return failure('PATH_ROOT_MISMATCH', {
      path: doc.path,
      kind: doc.kind,
      expected,
    })
  }
  return { ok: true, value: doc }
}

export function readDocument(input: unknown): Outcome<LedgerDocument> {
  const shape = readShape(input)
  if (!shape.ok) return shape

  const doc = shape.value
  switch (doc.type) {
    case 'transaction':
      return checkTransaction(doc)
    case 'account':
      return checkAccount(doc)
    default: {
      const unreacheable: never = doc
      return unreacheable
    }
  }
}
