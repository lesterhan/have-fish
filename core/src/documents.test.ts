import { describe, expect, it } from 'vitest'
import { PostingSchema, readShape, TransactionSchema } from './documents'

const A = '328e988b-cc8e-4a4d-98be-c0fddad78b20'
const B = '697100f4-7ad0-4d4c-bc61-b61abbf3dd6f'
const UUID = '8a7283de-26e1-485d-8aef-414f2e2bfdf1'

const SPEND = {
  type: 'transaction',
  id: UUID,
  date: '1998-12-01',
  description: '90s stuff',
  postings: [
    { accountId: A, amount: '59.99', currency: 'CAD' },
    { accountId: B, amount: '-59.99', currency: 'CAD' },
  ],
  deletedAt: null,
} as const

describe('PostingSchema', () => {
  it('accepts a posting with its three fields', () => {
    const posting = { accountId: A, amount: '-12.50', currency: 'CAD' }
    expect(PostingSchema.safeParse(posting)).toStrictEqual({ success: true, data: posting })
  })
})

describe('TransactionSchema', () => {
  it('accepts a transaction with valid fields', () => {
    expect(TransactionSchema.safeParse(SPEND)).toStrictEqual({ success: true, data: SPEND })
  })
})

describe('readShape', () => {
  it('reads a valid transaction', () => {
    expect(readShape(SPEND)).toStrictEqual({
      ok: true,
      value: SPEND,
    })
  })

  it.each([
    ['bad type', { type: 'coffeebeans' }, 'type', 'invalid_value'],
    [
      'missing currency',
      {
        postings: [
          { accountId: A, amount: '59.99', currency: 'CAD' },
          { accountId: B, amount: '-59.99' },
        ],
      },
      'postings.1.currency',
      'invalid_type',
    ],
    ['id is not uuid', { id: 'some-id' }, 'id', 'invalid_format'],
    [
      'amount is number not string',
      {
        postings: [
          { accountId: A, amount: 59.99, currency: 'CAD' },
          { accountId: B, amount: -59.99, currency: 'CAD' },
        ],
      },
      'postings.0.amount',
      'invalid_type',
    ],
    ['extra field', { weight: '60KG' }, 'weight', 'unrecognized_keys'],
    [
      'extra field in posting',
      {
        postings: [
          { accountId: A, amount: '59.99', year: '2021', currency: 'CAD' },
          { accountId: B, amount: '-59.99', year: '2021', currency: 'CAD' },
        ],
      },
      'postings.0.year',
      'unrecognized_keys',
    ],
  ])('refuses %s', (_title, input, path, issue) => {
    expect(readShape({ ...SPEND, ...input })).toStrictEqual({
      ok: false,
      failure: {
        code: 'DOCUMENT_MALFORMED',
        details: {
          path,
          issue,
        },
      },
    })
  })
})
