import { describe, expect, it } from 'vitest'
import { PostingSchema, TransactionSchema } from './documents'

const A = '328e988b-cc8e-4a4d-98be-c0fddad78b20'
const B = '697100f4-7ad0-4d4c-bc61-b61abbf3dd6f'
const UUID = '8a7283de-26e1-485d-8aef-414f2e2bfdf1'

describe('PostingSchema', () => {
  it('accepts a posting with its three fields', () => {
    const posting = { accountId: A, amount: '-12.50', currency: 'CAD' }
    expect(PostingSchema.safeParse(posting)).toStrictEqual({ success: true, data: posting })
  })
})

describe('TransactionSchema', () => {
  it('accepts a transaction with valid fields', () => {
    const txn = {
      type: 'transaction',
      id: UUID,
      date: '1998-12-01',
      description: '90s stuff',
      postings: [
        { accountId: A, amount: '59.99', currency: 'CAD' },
        { accountId: B, amount: '-59.99', currency: 'CAD' },
      ],
      deletedAt: null,
    }
    expect(TransactionSchema.safeParse(txn)).toStrictEqual({ success: true, data: txn })
  })
})
