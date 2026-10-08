// Mostly a type test: `bun run check` is what holds most of it. Each `@ts-expect-error` line
// must fail to compile, and tsc reports the directive as unused if one starts compiling.

import { expect, expectTypeOf, test } from 'vitest'
import { failure, type Outcome } from './outcome'

test('a refusal is not ok, and fits an Outcome of any value', () => {
  const refused: Outcome<string> = failure('TOO_FEW_POSTINGS')
  expect(refused.ok).toBe(false)
})

test('ok narrows to the value', () => {
  const outcome = failure('TOO_FEW_POSTINGS') as Outcome<number>
  if (outcome.ok) expectTypeOf(outcome.value).toEqualTypeOf<number>()
})

test('every code takes the detail the table gives it', () => {
  failure('DOCUMENT_MALFORMED', { path: 'postings.1.amount', issue: 'invalid_type' })
  failure('DATE_INVALID', { date: '2026-02-30' })
  failure('TOO_FEW_POSTINGS')
  failure('UNSUPPORTED_CURRENCY', { currency: 'XYZ' })
  failure('AMOUNT_INVALID', { amount: 'twelve' })
  failure('POSTINGS_DO_NOT_BALANCE', { currency: 'CAD', cents: 1 })
  failure('TOMBSTONE_HAS_POSTINGS')
  failure('PATH_INVALID', { path: 'assets::cash' })
  failure('PATH_ROOT_MISMATCH', { path: 'expenses:food', kind: 'card', expected: 'liabilities' })
})

test('a code with detail refuses to compile without it', () => {
  // @ts-expect-error PATH_INVALID needs its path
  failure('PATH_INVALID')
  // @ts-expect-error a field the code doesn't carry
  failure('PATH_INVALID', { currency: 'CAD' })
  // @ts-expect-error half the detail is not the detail
  failure('POSTINGS_DO_NOT_BALANCE', { currency: 'CAD' })
})

test('a code without detail refuses one', () => {
  // @ts-expect-error TOO_FEW_POSTINGS carries nothing
  failure('TOO_FEW_POSTINGS', { path: 'postings' })
})

test('only the codes in the table exist', () => {
  // @ts-expect-error not a code
  failure('NOT_A_CODE')
})
