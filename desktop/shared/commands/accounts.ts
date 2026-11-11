// What adding and listing my accounts asks of main: each command's input, and what it answers.

import { ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
import { z } from 'zod'
import { type Money, typed } from './wire'

export const accountInputs = {
  /** `currency` null: it can hold any. */
  'account.add': z.strictObject({
    name: typed(200),
    kind: z.enum(ADDABLE_KINDS),
    currency: typed(8).nullable(),
    /** How much is in it today, or owed on it, as typed; empty for nothing. */
    start: typed(64).default(''),
  }),
  /** A starting balance for an account that has none. */
  'account.start': z.strictObject({ id: z.uuid(), amount: typed(64) }),
  'account.list': z.strictObject({}),
}

/** An account I added, as the Accounts list shows it. */
export type ListedAccount = {
  id: string
  /** Its path without the root: `visa`, `wise:cad`. */
  name: string
  kind: AddableKind
  /** The one currency it holds, or null for any. */
  currency: string | null
  /** What was in it, or owed on it, the day it started; null if it was never said. */
  start: (Money & { date: string }) | null
  /**
   * What its own postings sum to in each currency, by code, as the ledger holds it: what I owe is
   * below zero. None that sum to zero; empty for nothing in it.
   */
  balance: Money[]
}

export interface AccountValues {
  'account.add': { id: string }
  /** The starting balance's transaction; null when there was nothing to write (empty, or zero). */
  'account.start': { id: string | null }
  /** Sorted by name, without regard to case. */
  'account.list': ListedAccount[]
}

/** What an undo step of an account is called. */
export type AccountStep = { kind: 'addAccount'; name: string } | { kind: 'start'; name: string }
