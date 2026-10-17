import { describe, expect, it } from 'vitest'
import {
  AccountSchema,
  PostingSchema,
  readDocument,
  readShape,
  TransactionSchema,
} from './documents'

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

const ACCOUNT = {
  type: 'account',
  id: UUID,
  path: 'expenses:coffee:beans',
  kind: 'category',
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

describe('AccountSchema', () => {
  it('accepts an account with valid fields', () => {
    expect(AccountSchema.safeParse(ACCOUNT)).toStrictEqual({ success: true, data: ACCOUNT })
  })
})

describe('readShape', () => {
  it('reads a valid transaction', () => {
    expect(readShape(SPEND)).toStrictEqual({
      ok: true,
      value: SPEND,
    })
  })

  it('reads a valid account', () => {
    expect(readShape(ACCOUNT)).toStrictEqual({
      ok: true,
      value: ACCOUNT,
    })
  })

  it.each([
    ['bad type', { ...SPEND, type: 'coffeebeans' }, 'type', 'invalid_union'],
    [
      'missing currency',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '59.99', currency: 'CAD' },
          { accountId: B, amount: '-59.99' },
        ],
      },
      'postings.1.currency',
      'invalid_type',
    ],
    ['id is not uuid', { ...SPEND, id: 'some-id' }, 'id', 'invalid_format'],
    [
      'amount is number not string',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: 59.99, currency: 'CAD' },
          { accountId: B, amount: -59.99, currency: 'CAD' },
        ],
      },
      'postings.0.amount',
      'invalid_type',
    ],
    ['extra field', { ...SPEND, weight: '60KG' }, 'weight', 'unrecognized_keys'],
    [
      'extra field in posting',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '59.99', year: '2021', currency: 'CAD' },
          { accountId: B, amount: '-59.99', year: '2021', currency: 'CAD' },
        ],
      },
      'postings.0.year',
      'unrecognized_keys',
    ],
    ['invalid account kind', { ...ACCOUNT, kind: 'piggybank' }, 'kind', 'invalid_value'],
  ])('refuses %s', (_title, document, path, issue) => {
    expect(readShape(document)).toStrictEqual({
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

describe('readDocument', () => {
  it('reads a valid spend', () => {
    expect(readDocument(SPEND)).toStrictEqual({ ok: true, value: SPEND })
  })

  it('passes through a shape failure', () => {
    expect(readDocument({ ...SPEND, weight: '60KG' })).toStrictEqual({
      ok: false,
      failure: {
        code: 'DOCUMENT_MALFORMED',
        details: {
          path: 'weight',
          issue: 'unrecognized_keys',
        },
      },
    })
  })

  it('tombstoned transaction has no postings', () => {
    const tombstone = { ...SPEND, deletedAt: 1760000000000, postings: [] }
    expect(readDocument(tombstone)).toStrictEqual({
      ok: true,
      value: tombstone,
    })
  })

  it('reads a valid account', () => {
    expect(readDocument(ACCOUNT)).toStrictEqual({
      ok: true,
      value: ACCOUNT,
    })
  })

  it.each([
    [
      'invalid date',
      {
        ...SPEND,
        date: '1998-02-30',
      },
      'DATE_INVALID',
      { date: '1998-02-30' },
    ],
    [
      'too few postings',
      {
        ...SPEND,
        postings: [{ accountId: A, amount: '15.50', currency: 'CAD' }],
      },
      'TOO_FEW_POSTINGS',
      undefined,
    ],
    [
      'unsupported currency',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '15.50', currency: 'ZZZ' },
          { accountId: B, amount: '-15.50', currency: 'ZZZ' },
        ],
      },
      'UNSUPPORTED_CURRENCY',
      { currency: 'ZZZ' },
    ],
    [
      'invalid amount',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '15.50.2', currency: 'CAD' },
          { accountId: B, amount: '-10.50', currency: 'CAD' },
        ],
      },
      'AMOUNT_INVALID',
      { amount: '15.50.2' },
    ],
    [
      'unbalanced postings',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '15.50', currency: 'CAD' },
          { accountId: B, amount: '-10.50', currency: 'CAD' },
        ],
      },
      'POSTINGS_DO_NOT_BALANCE',
      { currency: 'CAD', cents: 500 },
    ],
    [
      'tombstone with postings',
      { ...SPEND, deletedAt: 1760000000000 },
      'TOMBSTONE_HAS_POSTINGS',
      undefined,
    ],
    [
      'invalid account name',
      { ...ACCOUNT, path: 'expenses::coffee:::beans' },
      'PATH_INVALID',
      { path: 'expenses::coffee:::beans' },
    ],
    [
      'mismatched path root',
      { ...ACCOUNT, path: 'expenses:coffee:beans', kind: 'card' },
      'PATH_ROOT_MISMATCH',
      { path: 'expenses:coffee:beans', kind: 'card', expected: 'liabilities' },
    ],
  ])('refuses %s', (_title, document, code, details) => {
    expect(readDocument(document)).toStrictEqual({
      ok: false,
      failure: {
        code,
        details,
      },
    })
  })
})
