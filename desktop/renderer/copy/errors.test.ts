import type { FailureCode, FailureDetails } from '@have-fish/core/outcome'
import { describe, expect, test } from 'vitest'
import type { WireFailure } from '../../shared/commands'
import { fieldOf, wordsFor } from './errors'

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
    expect(fieldOf(refused('ACCOUNT_DELETED', { accountId: 'a' }))).toBe('form')
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

  test('a code with no words of its own still says something, and names the code', () => {
    expect(wordsFor(refused('ACCOUNT_DELETED', { accountId: 'a' }))).toMatch(/ACCOUNT_DELETED/)
  })
})
