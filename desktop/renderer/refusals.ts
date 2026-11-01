// Which field shows a refusal, and the words it shows.

import { copy } from '../copy'
import type { WireFailure } from '../shared/commands'

export type Field = 'amount' | 'description' | 'form'

const FIELDS: readonly string[] = ['amount', 'description']

export function fieldOf(failure: WireFailure): Field {
  switch (failure.error) {
    case 'AMOUNT_INVALID':
    case 'AMOUNT_NOT_POSITIVE':
      return 'amount'
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
