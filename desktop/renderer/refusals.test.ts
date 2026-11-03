import type { FailureCode, FailureDetails } from '@have-fish/core/outcome'
import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import type { WireFailure } from '../shared/commands'
import { fieldOf, wordsFor } from './refusals'

const refused = <C extends FailureCode>(error: C, detail: FailureDetails[C]) =>
  ({ ok: false, error, detail }) as WireFailure

describe('fieldOf', () => {
  test('an amount that isn’t one, or isn’t more than zero, is the amount field’s', () => {
    expect(fieldOf(refused('AMOUNT_INVALID', { amount: 'abc' }))).toBe('amount')
    expect(fieldOf(refused('AMOUNT_NOT_POSITIVE', { amount: '0' }))).toBe('amount')
  })

  test('a malformed input belongs to the field it names', () => {
    expect(fieldOf(refused('INPUT_MALFORMED', { path: 'amount', issue: 'too_big' }))).toBe('amount')
    expect(fieldOf(refused('INPUT_MALFORMED', { path: 'description', issue: 'too_big' }))).toBe(
      'description',
    )
    expect(
      fieldOf(refused('DOCUMENT_MALFORMED', { path: 'description', issue: 'invalid_format' })),
    ).toBe('description')
  })

  test('anything else is the whole form’s', () => {
    expect(fieldOf(refused('UNEXPECTED', undefined))).toBe('form')
    expect(fieldOf(refused('INPUT_MALFORMED', { path: '', issue: 'invalid_type' }))).toBe('form')
  })

  test('an account that can’t pay is the From field’s', () => {
    expect(fieldOf(refused('ACCOUNT_NOT_FOUND', { accountId: 'a' }))).toBe('from')
    expect(fieldOf(refused('ACCOUNT_DELETED', { accountId: 'a' }))).toBe('from')
    const locked = { accountId: 'a', currency: 'CAD', locked: 'USD' }
    expect(fieldOf(refused('ACCOUNT_CURRENCY_LOCKED', locked))).toBe('from')
    expect(fieldOf(refused('INPUT_MALFORMED', { path: 'from', issue: 'invalid_format' }))).toBe(
      'from',
    )
  })
})

describe('wordsFor', () => {
  test('says what an amount looks like', () => {
    expect(wordsFor(refused('AMOUNT_INVALID', { amount: 'abc' }))).toMatch(/4\.50/)
  })

  test('too long says so', () => {
    expect(wordsFor(refused('INPUT_MALFORMED', { path: 'description', issue: 'too_big' }))).toMatch(
      /long/,
    )
  })

  test('an edit of a spend that has gone, been removed, or has no one amount says so', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(wordsFor(refused('TRANSACTION_NOT_FOUND', { id }))).toMatch(/isn't in your ledger/)
    expect(wordsFor(refused('TRANSACTION_DELETED', { id }))).toMatch(/taken back/)
    expect(wordsFor(refused('TRANSACTION_NOT_SIMPLE', { id }))).toMatch(/more than one amount/)
    expect(fieldOf(refused('TRANSACTION_NOT_SIMPLE', { id }))).toBe('form')
  })

  test('every code says something in words, never its own name', () => {
    for (const [code, words] of Object.entries(copy.errors.codes)) {
      expect(words, code).toMatch(/^\S.*\.$/)
      expect(words, code).not.toMatch(/[A-Z]{2,}_[A-Z]/)
    }
  })

  test('a refusal only a bug reaches still says what to do', () => {
    expect(wordsFor(refused('ORIGIN_CHANGED', { id: 'a' }))).toMatch(/Try again/)
  })
})
