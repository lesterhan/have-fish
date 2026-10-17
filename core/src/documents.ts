import { z } from 'zod'

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
