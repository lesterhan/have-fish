import { describe, expect, it } from 'bun:test'
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
  date: '2026-03-01T00:00:00.000Z',
  amount: '-4.50',
  description: 'STARBUCKS #123 Toronto',
}
const rent: ParsedTransaction = { ...coffee, amount: '-1200.00', description: 'Rent' }
const wise: ParsedTransaction = {
  isTransfer: true,
  date: '2026-03-01T00:00:00.000Z',
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
      { ...wise, date: '2026-03-02T00:00:00.000Z' },
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
      'f4fd725a5e03d92171368ec542d33198d1148ac4a8d13dd49d414bbf7f467966',
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
})
