// Which field shows a refusal, and the words it shows.

import { copy } from '../../copy'
import type { To, WireFailure } from '../../shared/commands'

export type Field = 'amount' | 'description' | 'date' | 'to' | 'from' | 'form'

const FIELDS: readonly string[] = ['amount', 'description', 'date', 'to', 'from']

/** `to`, what the refused command sent, says when an account refused is the one To named. */
export function fieldOf(failure: WireFailure, to?: To): Field {
  switch (failure.error) {
    case 'AMOUNT_INVALID':
    case 'AMOUNT_NOT_POSITIVE':
    case 'AMOUNT_TOO_PRECISE':
      return 'amount'
    case 'DATE_INVALID':
      return 'date'
    // The paths a spend's form names: an income source's in From, else a category's in To.
    case 'PATH_INVALID':
      return isIncome(failure.detail.path) ? 'from' : 'to'
    case 'TRANSFER_TO_ITSELF':
    case 'INCOME_NOT_TO_ACCOUNT':
      return 'to'
    case 'ACCOUNT_NOT_FOUND':
    case 'ACCOUNT_DELETED':
    case 'ACCOUNT_CURRENCY_LOCKED':
      return to !== undefined && 'account' in to && to.account === failure.detail.accountId
        ? 'to'
        : 'from'
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

/**
 * On a spend, a path is an income source's or a category's, and a bad one is said as one; a day
 * it can't read says how it can be typed.
 */
export function spendWordsFor(failure: WireFailure): string {
  if (failure.error === 'DATE_INVALID') return copy.spends.dateUnread
  if (failure.error !== 'PATH_INVALID') return wordsFor(failure)
  return isIncome(failure.detail.path) ? copy.spends.write.badIncome : copy.spends.write.badCategory
}

/** Two words of why, for the composer's refused part: short enough to sit inside the line. */
export function composerWordsFor(failure: WireFailure): string {
  const refused = copy.spends.composer.refused
  switch (failure.error) {
    case 'AMOUNT_INVALID':
      return refused.amount
    case 'AMOUNT_NOT_POSITIVE':
      return refused.positive
    case 'AMOUNT_TOO_PRECISE':
      return refused.precise
    case 'DATE_INVALID':
      return refused.date
    case 'PATH_INVALID':
      return isIncome(failure.detail.path) ? refused.from : refused.to
    case 'TRANSFER_TO_ITSELF':
      return refused.same
    case 'ACCOUNT_NOT_FOUND':
    case 'ACCOUNT_DELETED':
    case 'ACCOUNT_CURRENCY_LOCKED':
    case 'INCOME_NOT_TO_ACCOUNT':
      return refused.account
    default:
      return refused.form
  }
}

const isIncome = (path: string) => path.startsWith('income:')
