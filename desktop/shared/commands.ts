// What the window can ask main to do: each command's name, the input its schema takes, and the
// value it returns. Main implements them (`main/commands/`); the window imports only types.

import type { LedgerDocument } from '@have-fish/core/documents'
import type { FailureCode, FailureDetails } from '@have-fish/core/outcome'
import { z } from 'zod'

/** Long enough for anything typed by hand; the window is the least trusted process. */
const typed = (max: number) => z.string().max(max)

export const inputs = {
  'spend.write': z.strictObject({ amount: typed(64), description: typed(500) }),
  'transaction.list': z.strictObject({}),
}

/** One transaction as the list shows it. */
export type ListedTransaction = {
  id: string
  date: string
  description: string
  /** What it moved: the sum of its positive postings in each currency, by currency code. */
  amounts: Money[]
  /** Its one amount, when it moves one between two accounts in one currency: what an edit sets. */
  simple: Money | null
}

export type Money = { amount: string; currency: string }

export interface Values {
  'spend.write': { id: string }
  'transaction.list': ListedTransaction[]
}

export type CommandName = keyof typeof inputs
export type InputOf<N extends CommandName> = z.input<(typeof inputs)[N]>

/** A refusal as it crosses to the window: today's `{ error: CODE, detail }`. */
export type WireFailure = {
  [C in FailureCode]: { ok: false; error: C; detail: FailureDetails[C] }
}[FailureCode]

export type Wire<T> = { ok: true; value: T } | WireFailure

/** A document a batch wrote, announced once per batch after it commits. */
export type Changed = { type: LedgerDocument['type']; id: string }

/** What the preload puts on `window.haveFish`. */
export type Bridge = {
  invoke<N extends CommandName>(name: N, input: InputOf<N>): Promise<Wire<Values[N]>>
  /** Calls `listener` after each batch that wrote anything. Returns the unsubscribe. */
  onChanged(listener: (changed: Changed[]) => void): () => void
}
