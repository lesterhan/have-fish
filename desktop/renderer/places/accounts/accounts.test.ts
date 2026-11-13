import { describe, expect, test } from 'vitest'
import { HOME_CURRENCY } from '../../../shared/currency'
import { ANY, accountFieldOf, lockOf, owes, startCurrency, startingCurrency } from './accounts'

describe('startingCurrency', () => {
  test('cash holds any; a bank account, a card and a loan start at the home currency', () => {
    expect(startingCurrency('cash')).toBe(ANY)
    for (const kind of ['bank', 'card', 'loan'] as const) {
      expect(startingCurrency(kind)).toBe(HOME_CURRENCY)
    }
  })
})

describe('lockOf', () => {
  test('any is null, and a currency is itself', () => {
    expect(lockOf(ANY)).toBeNull()
    expect(lockOf('EUR')).toBe('EUR')
  })
})

describe('startCurrency', () => {
  test('the account’s; for one that holds any, the home currency', () => {
    expect(startCurrency('USD')).toBe('USD')
    expect(startCurrency(ANY)).toBe(HOME_CURRENCY)
    expect(startCurrency(null)).toBe(HOME_CURRENCY)
  })
})

describe('owes', () => {
  test('a card and a loan are owed; cash and a bank account are had', () => {
    expect(['cash', 'bank', 'card', 'loan'].map((k) => owes(k as 'cash'))).toEqual([
      false,
      false,
      true,
      true,
    ])
  })
})

describe('accountFieldOf', () => {
  test('a starting balance that isn’t an amount, or is one too many, shows under it', () => {
    expect(accountFieldOf({ ok: false, error: 'AMOUNT_INVALID', detail: { amount: 'x' } })).toBe(
      'start',
    )
    const yen = { amount: '1.5', currency: 'JPY' }
    expect(accountFieldOf({ ok: false, error: 'AMOUNT_TOO_PRECISE', detail: yen })).toBe('start')
    expect(
      accountFieldOf({ ok: false, error: 'ACCOUNT_ALREADY_STARTED', detail: { accountId: 'a' } }),
    ).toBe('start')
    const long = { path: 'start', issue: 'too_big' }
    expect(accountFieldOf({ ok: false, error: 'INPUT_MALFORMED', detail: long })).toBe('start')
  })

  test('a refusal about the name shows under it', () => {
    expect(accountFieldOf({ ok: false, error: 'ACCOUNT_NAME_EMPTY', detail: undefined })).toBe(
      'name',
    )
    expect(
      accountFieldOf({ ok: false, error: 'ACCOUNT_NAME_TAKEN', detail: { name: 'visa' } }),
    ).toBe('name')
    expect(accountFieldOf({ ok: false, error: 'PATH_INVALID', detail: { path: 'a::b' } })).toBe(
      'name',
    )
    const text = { path: 'path', issue: 'invalid_format' }
    expect(accountFieldOf({ ok: false, error: 'DOCUMENT_MALFORMED', detail: text })).toBe('name')
  })

  test('anything else shows under the button', () => {
    expect(accountFieldOf({ ok: false, error: 'UNEXPECTED', detail: undefined })).toBe('form')
    const kind = { path: 'kind', issue: 'invalid_value' }
    expect(accountFieldOf({ ok: false, error: 'INPUT_MALFORMED', detail: kind })).toBe('form')
  })
})
