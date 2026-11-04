// What the window can ask main to do: each command's name, the input its schema takes, and the
// value it returns. Main implements them (`main/commands/`); the window imports only types.

import { ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
import type { LedgerDocument } from '@have-fish/core/documents'
import type { Failure, FailureCode, FailureDetails } from '@have-fish/core/outcome'
import { z } from 'zod'

/** Long enough for anything typed by hand; the window is the least trusted process. */
const typed = (max: number) => z.string().max(max)

/**
 * Where the money goes: a category by name, without its root (`food:coffee`), one I've used or a
 * new one, empty for unsorted; or an account of mine by id, which makes it a transfer.
 */
const to = z.union([
  z.strictObject({ category: typed(200) }),
  z.strictObject({ account: z.uuid() }),
])

export type To = z.infer<typeof to>

/** A calendar day as typed, `YYYY-MM-DD`; main says whether it is one. */
const date = typed(10)

/** `to` or `date` left out: unchanged. */
const edit = z.strictObject({
  id: z.uuid(),
  amount: typed(64),
  description: typed(500),
  to: to.optional(),
  date: date.optional(),
})

export const inputs = {
  /** `from` null, or left out: the account used last on this machine, else the wallet. */
  'spend.write': z.strictObject({
    amount: typed(64),
    description: typed(500),
    from: z.uuid().nullable().default(null),
    /** Left out: unsorted. */
    to: to.default({ category: '' }),
    /** Left out, or empty: today, where I am. */
    date: date.default(''),
  }),
  /** The account a spend written now with no `from` would come out of. */
  'spend.assumedFrom': z.strictObject({}),
  'spend.edit': edit,
  /** Several edits, each its own batch, and one step to undo. */
  'spend.saveAll': z.strictObject({ edits: z.array(edit).min(1).max(1000) }),
  'spend.remove': z.strictObject({ id: z.uuid() }),
  'transaction.list': z.strictObject({}),
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
  'category.list': z.strictObject({}),
  'ledger.undo': z.strictObject({}),
  'ledger.redo': z.strictObject({}),
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
  /** For one amount, the name of the account it came out of, without its root. */
  from: string | null
  /**
   * For one amount from an account of mine, the name of the category or account it went to,
   * without its root: what an edit can change.
   */
  to: string | null
}

/** A category I've put a spend in, as the picker offers it. */
export type ListedCategory = {
  id: string
  /** Its path without the root: `food:coffee`. */
  name: string
  /** How many live transactions are in it. */
  uses: number
}

export type Money = { amount: string; currency: string }

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
}

/** What an undo or redo changed, so the window can select it: spends, or accounts. */
export type Moved = { spends: string[]; accounts: string[] }

export interface Values {
  'spend.write': { id: string }
  /** Null before there's an account to assume: the first spend makes the wallet. */
  'spend.assumedFrom': { id: string | null }
  'spend.edit': { id: string }
  /** Each edit in the order sent: saved, or refused and why. */
  'spend.saveAll': { id: string; refused: WireFailure | null }[]
  'spend.remove': { id: string }
  'transaction.list': ListedTransaction[]
  'account.add': { id: string }
  /** The starting balance's transaction; null when there was nothing to write (empty, or zero). */
  'account.start': { id: string | null }
  /** Sorted by name, without regard to case. */
  'account.list': ListedAccount[]
  /** The ones in use, most used first; never unsorted, which is what none means. */
  'category.list': ListedCategory[]
  /** Both empty when there was nothing to undo. */
  'ledger.undo': Moved
  'ledger.redo': Moved
}

export type CommandName = keyof typeof inputs
export type InputOf<N extends CommandName> = z.input<(typeof inputs)[N]>

/** A refusal as it crosses to the window: today's `{ error: CODE, detail }`. */
export type WireFailure = {
  [C in FailureCode]: { ok: false; error: C; detail: FailureDetails[C] }
}[FailureCode]

export type Wire<T> = { ok: true; value: T } | WireFailure

export function wireFailure({ code, details }: Failure): WireFailure {
  // The pair came from one member of `Failure`, so it fits one member of `WireFailure`.
  return { ok: false, error: code, detail: details } as WireFailure
}

/** A document a batch wrote, announced once per batch after it commits. */
export type Changed = { type: LedgerDocument['type']; id: string }

/** What the preload puts on `window.haveFish`. */
export type Bridge = {
  invoke<N extends CommandName>(name: N, input: InputOf<N>): Promise<Wire<Values[N]>>
  /** Calls `listener` after each batch that wrote anything. Returns the unsubscribe. */
  onChanged(listener: (changed: Changed[]) => void): () => void
  /** Calls `listener` with an action's id when it is chosen from the menu. Returns the unsubscribe. */
  onAction(listener: (id: string) => void): () => void
  /** Tells main where Undo and Redo would go now, so the menu can name it. */
  setTyping(typing: Typing): void
}

/** Whether Undo and Redo would take back or put back the focused field's typing. */
export type Typing = { undo: boolean; redo: boolean }
