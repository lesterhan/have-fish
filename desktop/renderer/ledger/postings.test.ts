import { describe, expect, test } from 'vitest'
import type { ListedLeg, ListedOrigin } from '../../shared/commands'
import {
  balancesOf,
  postingsOf,
  postingsText,
  provenanceOf,
  rootAndRest,
  widthsOf,
} from './postings'

const leg = (path: string | null, amount: string, currency = 'CAD'): ListedLeg => ({
  path,
  amount,
  currency,
})

describe('a transaction as text', () => {
  test('its day and description, then each account, amount and code in columns', () => {
    const transaction = {
      date: '2026-11-04',
      description: 'Cafe',
      legs: [leg('expenses:food', '35.00'), leg('assets:chequing', '-35.00')],
    }
    expect(postingsText(transaction, 'an account not here')).toBe(
      [
        '2026-11-04 Cafe',
        '    expenses:food     35.00 CAD',
        '    assets:chequing  -35.00 CAD',
      ].join('\n'),
    )
  })

  test('a once-written transaction has only its day', () => {
    expect(postingsText({ date: '2026-11-04', description: '', legs: [] }, 'missing')).toBe(
      '2026-11-04',
    )
  })

  test('an account that is not here yet is named as such', () => {
    const postings = postingsOf([leg(null, '-4.50')], 'an account not here')
    expect(postings).toEqual([
      { path: null, account: 'an account not here', amount: '-4.50', currency: 'CAD' },
    ])
  })
})

describe('the columns', () => {
  test('wide enough for the longest account and amount', () => {
    expect(
      widthsOf(postingsOf([leg('expenses:food', '-4.50'), leg('liabilities:visa', '12.5')], '')),
    ).toEqual({ account: 16, amount: 5 })
  })
})

describe('the balance check', () => {
  test('one per currency, in the order it appears, true when they sum to zero', () => {
    const legs = [
      leg('expenses:food', '35.00', 'EUR'),
      leg('assets:wise', '-15.00', 'EUR'),
      leg('assets:wise', '-20.00', 'EUR'),
      leg('assets:cash', '-20.00', 'CAD'),
      leg('expenses:travel', '20.00', 'CAD'),
    ]
    expect(balancesOf(legs)).toEqual([
      { currency: 'EUR', ok: true },
      { currency: 'CAD', ok: true },
    ])
  })

  test('a currency that does not balance is false', () => {
    expect(balancesOf([leg('expenses:food', '35.00', 'EUR')])).toEqual([
      { currency: 'EUR', ok: false },
    ])
  })
})

describe('where it came from', () => {
  const when = () => 'Thu 5 Nov 2026, 12:40'
  const origin = (fields: Partial<ListedOrigin> = {}): ListedOrigin => ({
    source: 'manual',
    at: 0,
    here: true,
    file: null,
    line: null,
    ...fields,
  })

  test('by hand, when, on this computer', () => {
    expect(provenanceOf(origin(), when)).toEqual([
      { text: 'Written by hand · Thu 5 Nov 2026, 12:40 · this computer' },
    ])
  })

  test('an import names its file, in the code face, and its line', () => {
    expect(
      provenanceOf(origin({ source: 'import', file: 'wise.csv', line: 15, here: false }), when),
    ).toEqual([
      { text: 'Imported from ' },
      { text: 'wise.csv', code: true },
      { text: ', line 15 · Thu 5 Nov 2026, 12:40 · another computer' },
    ])
  })

  test('the app itself says so', () => {
    expect(provenanceOf(origin({ source: 'system' }), when)).toEqual([
      { text: 'Made by have-fish · Thu 5 Nov 2026, 12:40 · this computer' },
    ])
  })
})

describe('an account path for colour', () => {
  test('the root keeps its colon, and the rest follows', () => {
    expect(rootAndRest('expenses:food:coffee')).toEqual({ root: 'expenses:', rest: 'food:coffee' })
  })

  test('a root alone is all root', () => {
    expect(rootAndRest('equity')).toEqual({ root: 'equity', rest: '' })
  })
})
