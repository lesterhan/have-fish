// The words for each refusal, said where a save was refused. Core and main send a code; the
// words live here. Which field shows them is the window's call (`renderer/refusals.ts`).

import type { FailureCode } from '@have-fish/core/outcome'

/** For a refusal only a bug reaches: nothing a person typed can cause it. */
const TRY_AGAIN = "That couldn't be saved. Try again."

/** Every code has words, so a new one in core fails `bun run check` until it's given some. */
const codes: { [C in FailureCode]: string } = {
  // What a person types.
  AMOUNT_INVALID: "That isn't an amount. Type a number, like 4.50.",
  AMOUNT_NOT_POSITIVE: 'A spend has to be more than zero.',
  DATE_INVALID: "That isn't a day on the calendar.",
  DOCUMENT_MALFORMED: "Some of that text can't be saved. Try typing it again.",
  UNSUPPORTED_CURRENCY: "have-fish doesn't know that currency.",

  // A transaction.
  POSTINGS_DO_NOT_BALANCE: "The money in and the money out don't add up to the same amount.",
  TOO_FEW_POSTINGS: 'A transaction needs money leaving one account and arriving in another.',
  TRANSACTION_DELETED: "That spend was taken back, so it can't be changed.",
  TRANSACTION_NOT_FOUND: "That spend isn't in your ledger any more.",
  TRANSACTION_NOT_SIMPLE: "This one moves more than one amount, so it can't be changed here yet.",

  // An account.
  ACCOUNT_NAME_EMPTY: 'Give it a name.',
  ACCOUNT_NAME_TAKEN: 'You already have an account with that name.',
  ACCOUNT_ALREADY_STARTED: 'That account already has a starting balance.',
  ACCOUNT_CURRENCY_LOCKED: 'That account only holds one currency, and this is a different one.',
  ACCOUNT_DELETED: 'That account was removed.',
  ACCOUNT_HOLDS_OTHER_CURRENCIES:
    "That account already holds other currencies, so it can't be kept to one.",
  ACCOUNT_IN_USE: "That account still has transactions in it, so it can't be removed.",
  ACCOUNT_NOT_FOUND: "That account isn't in your ledger any more.",
  PATH_INVALID: "That isn't a name an account can have.",
  PATH_ROOT_MISMATCH: "That account's name doesn't fit its kind.",

  // Undo and redo.
  CHANGED_SINCE: "That's been changed since, so it can't be undone.",

  // The ledger file, and other devices.
  CLOCK_DRIFT: "Another device's clock is far ahead. Check its date and time.",
  LEDGER_TOO_NEW: 'Your ledger was saved by a newer version of have-fish.',
  LEDGER_UNREADABLE: "Your ledger can't be read.",

  // Only a bug reaches these.
  COMMAND_UNKNOWN: TRY_AGAIN,
  INPUT_MALFORMED: TRY_AGAIN,
  ORIGIN_CHANGED: TRY_AGAIN,
  TOMBSTONE_HAS_POSTINGS: TRY_AGAIN,
  UNEXPECTED: 'Something went wrong. Try again.',
  VERSION_MALFORMED: TRY_AGAIN,
}

export const errors = {
  codes,
  /** An input longer than its field takes. */
  tooLong: "That's too long to save.",
}
