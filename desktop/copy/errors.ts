// The words for each refusal, said where a save was refused. Core and main send a code; the
// words live here. Which field shows them is the window's call (`renderer/refusals.ts`).

import type { FailureCode } from '@have-fish/core/outcome'

const codes: { [C in FailureCode]?: string } = {
  AMOUNT_INVALID: "That isn't an amount. Type a number, like 4.50.",
  AMOUNT_NOT_POSITIVE: 'A spend has to be more than zero.',
  DOCUMENT_MALFORMED: "Some of that text can't be saved. Try typing it again.",
  UNEXPECTED: 'Something went wrong. Try again.',
  TRANSACTION_NOT_FOUND: "That spend isn't in your ledger any more.",
  TRANSACTION_DELETED: "That spend was taken back, so it can't be changed.",
  TRANSACTION_NOT_SIMPLE: "This one moves more than one amount, so it can't be changed here yet.",
}

export const errors = {
  codes,
  /** An input longer than its field takes. */
  tooLong: "That's too long to save.",
  /** A code with no words of its own. */
  unknown: (code: FailureCode) => `That couldn't be saved (${code}).`,
}
