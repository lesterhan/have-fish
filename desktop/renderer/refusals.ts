// Which field shows a refusal, and the words it shows.

import { copy } from '../copy'
import type { WireFailure } from '../shared/commands'

export type Field = 'amount' | 'description' | 'from' | 'form'

const FIELDS: readonly string[] = ['amount', 'description', 'from']

export function fieldOf(failure: WireFailure): Field {
  switch (failure.error) {
    case 'AMOUNT_INVALID':
    case 'AMOUNT_NOT_POSITIVE':
      return 'amount'
    case 'ACCOUNT_NOT_FOUND':
    case 'ACCOUNT_DELETED':
    case 'ACCOUNT_CURRENCY_LOCKED':
      return 'from'
    case 'INPUT_MALFORMED':
    case 'DOCUMENT_MALFORMED':
      return FIELDS.includes(failure.detail.path) ? (failure.detail.path as Field) : 'form'
    default:
      return 'form'
  }
}

export function wordsFor(failure: WireFailure): string {
  if (failure.error === 'INPUT_MALFORMED' && failure.detail.issue === 'too_big') {
    return copy.errors.tooLong
  }
  return copy.errors.codes[failure.error]
}
