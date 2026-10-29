import { describe, expect, it } from 'vitest'
import {
  AccountOriginSchema,
  AccountSchema,
  PostingSchema,
  readDocument,
  readShape,
  TransactionOriginSchema,
  TransactionSchema,
} from './documents'

const A = '328e988b-cc8e-4a4d-98be-c0fddad78b20'
const B = '697100f4-7ad0-4d4c-bc61-b61abbf3dd6f'
const C = 'e795ff15-ce02-4abb-9642-928b57bca6f3'
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

const MADE = { createdAt: Date.UTC(2026, 9, 28, 9), deviceId: 'a1b2c3d4e5f60718' }
const MANUAL = { source: 'manual', ...MADE } as const
const SYSTEM = { source: 'system', ...MADE } as const
const IMPORTED = {
  source: 'import',
  ...MADE,
  file: 'td-oct.csv',
  line: 15,
  text: 'Alp**Mannerswudaokou',
} as const

describe('TransactionOriginSchema', () => {
  it.each([
    ['manual', MANUAL],
    ['import', IMPORTED],
    ['system', SYSTEM],
  ])('accepts a %s origin', (_title, origin) => {
    expect(TransactionOriginSchema.safeParse(origin)).toStrictEqual({ success: true, data: origin })
  })

  it.each([
    ['an unknown source', { ...MANUAL, source: 'fish-pie' }],
    ['no source', MADE],
    ['an import without its file', { ...IMPORTED, file: undefined }],
    ['an import with an empty file name', { ...IMPORTED, file: '' }],
    ['an import without its line', { ...IMPORTED, line: undefined }],
    ['an import on line 0', { ...IMPORTED, line: 0 }],
    ['an import on a fractional line', { ...IMPORTED, line: 1.5 }],
    ['an import without its text', { ...IMPORTED, text: undefined }],
    ['a manual origin with a file', { ...MANUAL, file: 'td-oct.csv' }],
    ['no createdAt', { ...MANUAL, createdAt: undefined }],
    ['a negative createdAt', { ...MANUAL, createdAt: -1 }],
    ['a fractional createdAt', { ...MANUAL, createdAt: 1.5 }],
    ['no deviceId', { ...MANUAL, deviceId: undefined }],
    ['a deviceId that is not 16 hex', { ...MANUAL, deviceId: 'laptop' }],
  ])('refuses %s', (_title, origin) => {
    expect(TransactionOriginSchema.safeParse(origin).success).toBe(false)
  })
})

describe('AccountOriginSchema', () => {
  it.each([
    ['manual', MANUAL],
    ['system', SYSTEM],
  ])('accepts a %s origin', (_title, origin) => {
    expect(AccountOriginSchema.safeParse(origin)).toStrictEqual({ success: true, data: origin })
  })

  it('refuses an import: nothing imports accounts', () => {
    expect(AccountOriginSchema.safeParse(IMPORTED).success).toBe(false)
  })
})

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

  it('reads a multicurrency conversion', () => {
    const conversion = {
      ...SPEND,
      postings: [
        { accountId: A, amount: '10.00', currency: 'CAD' },
        { accountId: B, amount: '-10.00', currency: 'CAD' },
        { accountId: B, amount: '7.00', currency: 'EUR' },
        { accountId: C, amount: '-7.00', currency: 'EUR' },
      ],
    }
    expect(readDocument(conversion)).toStrictEqual({ ok: true, value: conversion })
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

describe('canonical form', () => {
  it.each([
    [
      '5.0',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '5.0', currency: 'CAD' },
          { accountId: B, amount: '-5.0', currency: 'CAD' },
        ],
      },
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '5.00', currency: 'CAD' },
          { accountId: B, amount: '-5.00', currency: 'CAD' },
        ],
      },
    ],
    [
      '5.004',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '5.004', currency: 'CAD' },
          { accountId: B, amount: '-5.004', currency: 'CAD' },
        ],
      },
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '5.00', currency: 'CAD' },
          { accountId: B, amount: '-5.00', currency: 'CAD' },
        ],
      },
    ],
    [
      '5',
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '5', currency: 'CAD' },
          { accountId: B, amount: '-5', currency: 'CAD' },
        ],
      },
      {
        ...SPEND,
        postings: [
          { accountId: A, amount: '5.00', currency: 'CAD' },
          { accountId: B, amount: '-5.00', currency: 'CAD' },
        ],
      },
    ],
  ])(
    '%s is transformed to canonical form, readDocument is idempotent',
    (_title, inputDoc, canonicalDoc) => {
      expect(readDocument(inputDoc)).toStrictEqual({ ok: true, value: canonicalDoc })
      expect(readDocument(canonicalDoc)).toStrictEqual({ ok: true, value: canonicalDoc })
    },
  )
})

describe('JSON round trip', () => {
  it.each([
    ['transaction doc', SPEND],
    ['account doc', ACCOUNT],
    ['tombstoned transaction', { ...SPEND, deletedAt: 1760000000000, postings: [] }],
  ])('%s is read back without change', (_title, doc) => {
    const jsonWire = JSON.parse(JSON.stringify(doc))
    expect(readDocument(jsonWire)).toStrictEqual({ ok: true, value: doc })
  })
})
