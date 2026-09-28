import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  IMPORT_KEY,
  importFingerprint,
  importTransactionId,
  normaliseDescription,
  rowKeys,
  uuidv5,
} from './fingerprint'
import type { ParsedTransaction } from './types'

// No database here. These values are what every device has to compute identically, so a
// failure here means imported statements would stop matching their earlier imports.

const coffee: ParsedTransaction = {
  isTransfer: false,
  date: '2026-03-01',
  amount: '-4.50',
  description: 'STARBUCKS #123 Toronto',
}
const rent: ParsedTransaction = { ...coffee, amount: '-1200.00', description: 'Rent' }
const wise: ParsedTransaction = {
  isTransfer: true,
  date: '2026-03-01',
  description: 'To GBP',
  sourceAmount: '-200.00',
  sourceCurrency: 'CAD',
  targetAmount: '107.90',
  targetCurrency: 'GBP',
  feeAmount: '0.96',
  feeCurrency: 'CAD',
}

describe('uuidv5', () => {
  it('matches the RFC example and Bun’s own implementation', () => {
    const dns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    expect(uuidv5(dns, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
    for (const name of ['', 'a', 'ünïcödé', 'x'.repeat(500)]) {
      expect(uuidv5(dns, name)).toBe(Bun.randomUUIDv5(name, dns))
    }
  })
})

describe('normaliseDescription', () => {
  it('ignores surrounding and repeated whitespace, and case', () => {
    expect(normaliseDescription('  STARBUCKS\t #123   Toronto \n')).toBe('starbucks #123 toronto')
    expect(normaliseDescription(undefined)).toBe('')
  })

  it('reads composed and decomposed accents as the same text', () => {
    expect(normaliseDescription('Café')).toBe(normaliseDescription('Café'))
  })
})

describe('rowKeys', () => {
  it('gives each row a 64-digit hex key, the same every time the file is read', () => {
    const keys = rowKeys('parser', [coffee, rent, wise])
    for (const key of keys) expect(key).toMatch(IMPORT_KEY)
    expect(rowKeys('parser', [coffee, rent, wise])).toEqual(keys)
    expect(new Set(keys).size).toBe(3)
  })

  it('stays the same when the description changes only in whitespace or case', () => {
    const [a] = rowKeys('parser', [coffee])
    const [b] = rowKeys('parser', [{ ...coffee, description: '  starbucks   #123 TORONTO ' }])
    expect(b).toBe(a)
  })

  it('tells identical rows in one file apart by their order among themselves', () => {
    const keys = rowKeys('parser', [coffee, coffee])
    expect(keys[0]).not.toBe(keys[1])
    // An unrelated row in between changes nothing: only identical rows count.
    expect(rowKeys('parser', [coffee, rent, coffee])).toEqual([
      keys[0],
      expect.any(String),
      keys[1],
    ])
  })

  it('changes with the parser, the date, any amount, currency or fee, and the kind', () => {
    const [base] = rowKeys('parser', [wise])
    const variants: ParsedTransaction[] = [
      { ...wise, date: '2026-03-02' },
      { ...wise, sourceAmount: '-200.01' },
      { ...wise, targetCurrency: 'EUR' },
      { ...wise, feeAmount: '0.97' },
      { ...wise, feeAmount: undefined, feeCurrency: undefined },
    ]
    for (const v of variants) expect(rowKeys('parser', [v])[0]).not.toBe(base)
    expect(rowKeys('other-parser', [wise])[0]).not.toBe(base)
    expect(rowKeys('parser', [coffee])[0]).not.toBe(
      rowKeys('parser', [{ ...coffee, currency: 'USD' }])[0],
    )
    const sameCurrency: ParsedTransaction = {
      isTransfer: 'same-currency',
      date: coffee.date,
      description: coffee.description,
      amount: '-4.50',
      feeAmount: '0.00',
      currency: 'CAD',
    }
    expect(rowKeys('parser', [sameCurrency])[0]).not.toBe(rowKeys('parser', [coffee])[0])
  })

  // Pinned: if this changes, every statement imported before would import again. Worked
  // out separately, in Python, from the description in fingerprint.ts.
  it('has not changed', () => {
    expect(rowKeys('parser', [coffee])).toEqual([
      '470d6f4e5bdc8ce818393d07248565e6d39ff740ed661ef51d497e708fcd876c',
    ])
    expect(rowKeys('wise', [wise])).toEqual([
      'f042cf34f58a2d15020d0b7461febf937aaeb60f97ce2e6fd533141595b794c3',
    ])
  })
})

describe('importFingerprint and importTransactionId', () => {
  const [key = ''] = rowKeys('parser', [coffee])

  it('binds a row key to its statement account', () => {
    expect(importFingerprint('chequing', key)).toMatch(IMPORT_KEY)
    expect(importFingerprint('chequing', key)).toBe(importFingerprint('chequing', key))
    expect(importFingerprint('savings', key)).not.toBe(importFingerprint('chequing', key))
  })

  it('gives the same id to the same user and fingerprint, and a different one otherwise', () => {
    const fp = importFingerprint('chequing', key)
    const id = importTransactionId('user-a', fp)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(importTransactionId('user-a', fp)).toBe(id)
    expect(importTransactionId('user-b', fp)).not.toBe(id)
    expect(importTransactionId('user-a', importFingerprint('savings', key))).not.toBe(id)
  })

  // Pinned, and worked out in Python like the row key: these are stored on every imported
  // transaction, so a change here would import every earlier statement again.
  it('has not changed', () => {
    const fp = importFingerprint('chequing', key)
    expect(fp).toBe('91c13639167c198e96390991874b45766ae27a6f2ccbe3918318af12738b2c19')
    expect(importTransactionId('user-a', fp)).toBe('7a383859-ddf2-5701-932c-9da5bd91ba88')
  })
})

// The hashes are pure JavaScript so that a phone can mint the same keys (#474), and they
// replaced `node:crypto`, which minted every key stored before. This holds the two to the
// same bytes on text a bank export can carry: accents, emoji, CJK, and a lone surrogate.
describe('the hashes agree with node:crypto', () => {
  const names = ['', 'a', 'ünïcödé', 'e\u0301', '有鱼 🐟', '\ud83d', 'x'.repeat(1000), '"\\\n']
  const nodeSha256 = (parts: string[]) =>
    createHash('sha256').update(JSON.stringify(parts)).digest('hex')

  it('in the fingerprint', () => {
    for (const account of names) {
      for (const rowKey of names) {
        expect(importFingerprint(account, rowKey)).toBe(
          nodeSha256(['import-fingerprint/v1', account, rowKey]),
        )
      }
    }
  })

  it('in the row key', () => {
    for (const description of names) {
      const [rowKey] = rowKeys('parser', [{ ...coffee, description }])
      const identity = JSON.stringify([
        'parser',
        'regular',
        coffee.date,
        coffee.amount,
        '',
        normaliseDescription(description),
      ])
      expect(rowKey).toBe(nodeSha256(['import-fingerprint/v1', identity, '0']))
    }
  })

  it('in the UUIDv5', () => {
    const ns = 'e788c43d-d22f-43f1-8d0d-3922a1b0bf78'
    for (const name of names) expect(uuidv5(ns, name)).toBe(Bun.randomUUIDv5(name, ns))
  })
})
