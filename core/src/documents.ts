import { z } from 'zod'
import type { Outcome } from './outcome'
import { failure } from './outcome'

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
  deletedAt: z.nullable(z.number()),
})

export type TransactionDoc = z.infer<typeof TransactionSchema>

export function readShape(input: unknown): Outcome<TransactionDoc> {
  const result = TransactionSchema.safeParse(input)
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
