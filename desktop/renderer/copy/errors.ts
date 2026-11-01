// The words for a refusal, and which field shows them. The core and main send codes; the words
// live here.

import type { FailureCode } from '@have-fish/core/outcome'
import type { WireFailure } from '../../shared/commands'

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

const WORDS: { [C in FailureCode]?: string } = {
  AMOUNT_INVALID: "That isn't an amount. Type a number, like 4.50.",
  AMOUNT_NOT_POSITIVE: 'A spend has to be more than zero.',
  DOCUMENT_MALFORMED: "Some of that text can't be saved. Try typing it again.",
  UNEXPECTED: 'Something went wrong. Try again.',
}

export function wordsFor(failure: WireFailure): string {
  if (failure.error === 'INPUT_MALFORMED' && failure.detail.issue === 'too_big') {
    return "That's too long to save."
  }
  return WORDS[failure.error] ?? `That couldn't be saved (${failure.error}).`
}
