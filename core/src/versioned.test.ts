import { describe, expect, it } from 'vitest'
import { readVersioned } from './versioned'

const A = '328e988b-cc8e-4a4d-98be-c0fddad78b20'
const B = '697100f4-7ad0-4d4c-bc61-b61abbf3dd6f'
const UUID = '8a7283de-26e1-485d-8aef-414f2e2bfdf1'

const SPEND = {
  type: 'transaction',
  id: UUID,
  date: '2026-10-04',
  description: 'coffee',
  postings: [
    { accountId: A, amount: '4.50', currency: 'CAD' },
    { accountId: B, amount: '-4.50', currency: 'CAD' },
  ],
  deletedAt: null,
  origin: { source: 'manual', createdAt: Date.UTC(2026, 9, 4, 11), deviceId: 'a1b2c3d4e5f60718' },
} as const

const VERSION = { wallMs: Date.UTC(2026, 9, 4, 12), counter: 0, deviceId: 'a1b2c3d4e5f60718' }
const ENVELOPE = { doc: SPEND, version: VERSION }

const malformed = (path: string, issue: string) => ({
  ok: false,
  failure: { code: 'VERSION_MALFORMED', details: { path, issue } },
})

describe('readVersioned', () => {
  it('accepts a good envelope', () => {
    expect(readVersioned(ENVELOPE)).toStrictEqual({ ok: true, value: ENVELOPE })
  })

  it('reads back equal after a JSON round trip', () => {
    expect(readVersioned(JSON.parse(JSON.stringify(ENVELOPE)))).toStrictEqual({
      ok: true,
      value: ENVELOPE,
    })
  })

  it('hands back the document in its canonical form', () => {
    const loose = {
      ...SPEND,
      postings: [
        { accountId: A, amount: '5', currency: 'CAD' },
        { accountId: B, amount: '-5', currency: 'CAD' },
      ],
    }
    const result = readVersioned({ doc: loose, version: VERSION })
    expect(
      result.ok && result.value.doc.type === 'transaction' && result.value.doc.postings,
    ).toEqual([
      { accountId: A, amount: '5.00', currency: 'CAD' },
      { accountId: B, amount: '-5.00', currency: 'CAD' },
    ])
  })

  it.each([
    [
      'a counter past four hex digits',
      { ...VERSION, counter: 0x10000 },
      'version.counter',
      'too_big',
    ],
    ['a negative counter', { ...VERSION, counter: -1 }, 'version.counter', 'too_small'],
    ['a fractional wall time', { ...VERSION, wallMs: 1.5 }, 'version.wallMs', 'invalid_type'],
    ['a wall time past 9999', { ...VERSION, wallMs: 253402300800000 }, 'version.wallMs', 'too_big'],
    ['a short device id', { ...VERSION, deviceId: 'a1b2c3' }, 'version.deviceId', 'invalid_format'],
    [
      'an uppercase device id',
      { ...VERSION, deviceId: 'A1B2C3D4E5F60718' },
      'version.deviceId',
      'invalid_format',
    ],
    ['a missing device id', { wallMs: 0, counter: 0 }, 'version.deviceId', 'invalid_type'],
    ['an extra field', { ...VERSION, node: 'x' }, 'version.node', 'unrecognized_keys'],
    [
      'the text form instead of the object',
      '2026-10-04T12:00:00.000Z-0000-a1b2c3d4e5f60718',
      'version',
      'invalid_type',
    ],
    ['no version at all', undefined, 'version', 'invalid_type'],
  ])('refuses %s as VERSION_MALFORMED', (_title, version, path, issue) => {
    expect(readVersioned({ doc: SPEND, version })).toStrictEqual(malformed(path, issue))
  })

  it('refuses an envelope with an extra field, or that is not an object', () => {
    expect(readVersioned({ ...ENVELOPE, sentAt: 1 })).toStrictEqual(
      malformed('sentAt', 'unrecognized_keys'),
    )
    expect(readVersioned(null)).toStrictEqual(malformed('', 'invalid_type'))
    expect(readVersioned([SPEND, VERSION])).toStrictEqual(malformed('', 'invalid_type'))
  })

  it('refuses a bad document with the document’s own code', () => {
    expect(
      readVersioned({ doc: { ...SPEND, date: '2026-02-30' }, version: VERSION }),
    ).toStrictEqual({
      ok: false,
      failure: { code: 'DATE_INVALID', details: { date: '2026-02-30' } },
    })
    expect(readVersioned({ doc: { ...SPEND, weight: '1kg' }, version: VERSION })).toStrictEqual({
      ok: false,
      failure: {
        code: 'DOCUMENT_MALFORMED',
        details: { path: 'weight', issue: 'unrecognized_keys' },
      },
    })
  })

  it('refuses an envelope with no document as VERSION_MALFORMED', () => {
    expect(readVersioned({ version: VERSION })).toStrictEqual(malformed('doc', 'invalid_type'))
  })

  it('checks the version before the document', () => {
    const both = { doc: { ...SPEND, date: '2026-02-30' }, version: { ...VERSION, counter: -1 } }
    expect(readVersioned(both)).toStrictEqual(malformed('version.counter', 'too_small'))
  })
})
