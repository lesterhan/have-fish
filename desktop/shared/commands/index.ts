// What the window can ask main to do: each command's name, the input its schema takes, and the
// value it returns. Main implements them (`main/commands/`); the window imports only types.

import { type AccountKind, ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
import type { LedgerDocument, OriginSource } from '@have-fish/core/documents'
import type { Failure, FailureCode, FailureDetails } from '@have-fish/core/outcome'
import type { ShapeName } from '@have-fish/core/shapes'
import { z } from 'zod'
import { DENSITIES, type Density } from '../density'
import type { StepName } from '../steps'
import { THEME_CHOICES, type ThemeChoice } from '../theme/theme'

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

/**
 * Where the money comes from: an account of mine by id; an income source by name, without its
 * root (`salary`), one I've used or a new one, which makes it income; or null for the account
 * used last on this machine, else the wallet.
 */
const from = z.union([z.uuid(), z.strictObject({ income: typed(200) })]).nullable()

export type From = z.infer<typeof from>

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
  /** Money in, out, or between my accounts: which, `from` and `to` say. */
  'spend.write': z.strictObject({
    amount: typed(64),
    description: typed(500),
    from: from.default(null),
    /** Left out: unsorted. */
    to: to.default({ category: '' }),
    /** Left out, or empty: today, where I am. */
    date: date.default(''),
  }),
  /** The account a spend written now with no `from` would come out of. */
  'spend.assumedFrom': z.strictObject({}),
  'spend.edit': edit,
  'spend.remove': z.strictObject({ id: z.uuid() }),
  /** `limit` rows of the ledger's list from row `from`, newest first: what a list draws. */
  'transaction.page': z.strictObject({
    from: z.number().int().min(0),
    limit: z.number().int().min(1).max(500),
  }),
  /** Where a transaction is in the list, so the window can show it however far down. */
  'transaction.position': z.strictObject({ id: z.uuid() }),
  /** Every day of the list and its count: where its day bands fall. */
  'transaction.days': z.strictObject({}),
  /** The live ones of these, in the list's order. */
  'transaction.get': z.strictObject({ ids: z.array(z.uuid()).max(1000) }),
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
  /** Every account and category, for a path picker: its whole path, kind and last use. */
  'path.list': z.strictObject({}),
  /** What went to each category from `start` to `end`, both days in it. */
  'report.spending': z.strictObject({ start: date, end: date }),
  'ledger.undo': z.strictObject({}),
  'ledger.redo': z.strictObject({}),
  /** What Undo and Redo would take, by name; it changes nothing. */
  'ledger.steps': z.strictObject({}),
  /** This machine's theme: never the ledger's. */
  'settings.theme.set': z.strictObject({ theme: z.enum(THEME_CHOICES) }),
  /** How tightly this machine sets the ledger: never the ledger's. */
  'settings.density.get': z.strictObject({}),
  'settings.density.set': z.strictObject({ density: z.enum(DENSITIES) }),
  /** Text the window put together, onto the system clipboard. It writes nothing to the ledger. */
  'clipboard.copy': z.strictObject({ text: z.string().max(20_000) }),
}

/** One posting as a row's details read it: what it moved, and the account or category it touched. */
export type ListedLeg = {
  /** Signed: below zero is money leaving that account. */
  amount: string
  currency: string
  /** Its account's or category's whole path; null when that account isn't here yet. */
  path: string | null
}

/** Where a transaction came from, as its details say it. */
export type ListedOrigin = {
  source: OriginSource
  /** UTC ms. */
  at: number
  /** Whether this ledger's own device made it, rather than another computer's copy. */
  here: boolean
  /** The bank's file, for an import; null otherwise. */
  file: string | null
  /** Its line in that file, for an import; null otherwise. */
  line: number | null
}

/** One transaction as the list shows it. */
export type ListedTransaction = {
  id: string
  date: string
  description: string
  /** What it is: a spend, a transfer, income, a starting balance, or other. */
  shape: ShapeName
  /** What it moved: the sum of its positive postings in each currency, by currency code. */
  amounts: Money[]
  /** Its one amount, when it moves one between two accounts in one currency: what an edit sets. */
  simple: Money | null
  /**
   * For a spend, transfer or income, the name of the account of mine or income source it came out
   * of, without its root; for a starting balance, the card or loan it put what I owe on.
   */
  from: string | null
  /**
   * For a spend or transfer, the name of the category or account it went to; for income, the
   * account of mine it went to. Without its root: what an edit can change.
   */
  to: string | null
  /** `from` and `to` as whole paths, root and all, for their tags. */
  fromPath: string | null
  toPath: string | null
  /** Each posting, in order: how a spend paid from more than one account says so. */
  legs: ListedLeg[]
  /** Where it came from: by hand, an import, or the app; when; and on which computer. */
  origin: ListedOrigin
}

/** A day of the ledger's list, and how many rows it has. */
export type ListedDay = { date: string; count: number }

/** What a day came to: money in less money out, per currency. A move between my accounts is neither. */
export type DayNet = { date: string; net: Money[] }

/** An account or category as a path picker offers it. */
export type ListedPath = {
  id: string
  /** Its whole path, root and all: `expenses:food:coffee`. */
  path: string
  kind: AccountKind
  /** UTC ms of the latest live transaction that used it; null if none has. */
  lastUsed: number | null
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
  /**
   * What its own postings sum to in each currency, by code, as the ledger holds it: what I owe is
   * below zero. None that sum to zero; empty for nothing in it.
   */
  balance: Money[]
}

/** One spend's money in one category, as a report sums it. */
export type ReportedSpend = {
  /** The transaction's id. */
  id: string
  /** Its name without the root (`food:coffee`); `''` for unsorted. */
  category: string
  amount: string
}

/** What an undo or redo changed, so the window can select it: spends, or accounts. */
export type Moved = { spends: string[]; accounts: string[] }

export interface Values {
  'spend.write': { id: string }
  /** Null before there's an account to assume: the first spend makes the wallet. */
  'spend.assumedFrom': { id: string | null }
  'spend.edit': { id: string }
  /** Each edit in the order sent: saved, or refused and why. */
  'spend.remove': { id: string }
  /** `total` is every live row, so a list's scrollbar is the whole list's. */
  /** With the net of each day it has a row of: the whole day's, not only its rows here. */
  'transaction.page': { total: number; from: number; rows: ListedTransaction[]; nets: DayNet[] }
  /** Newest day first. */
  'transaction.days': ListedDay[]
  /** Counting from 0; null when it isn't live. */
  'transaction.position': { at: number | null }
  'transaction.get': ListedTransaction[]
  'account.add': { id: string }
  /** The starting balance's transaction; null when there was nothing to write (empty, or zero). */
  'account.start': { id: string | null }
  /** Sorted by name, without regard to case. */
  'account.list': ListedAccount[]
  /** Every live account and category, by path. */
  'path.list': ListedPath[]
  /**
   * In the home currency, `currency`, oldest day first. `other` is what went to categories in
   * each other currency, by code: none that sum to zero.
   */
  'report.spending': { currency: string; spent: ReportedSpend[]; other: Money[] }
  /** Both empty when there was nothing to undo. */
  'ledger.undo': Moved
  'ledger.redo': Moved
  'ledger.steps': { undo: StepName | null; redo: StepName | null }
  'settings.theme.set': { theme: ThemeChoice }
  'settings.density.get': { density: Density }
  'settings.density.set': { density: Density }
  'clipboard.copy': null
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

/** A document a command wrote, announced once per command after its last batch commits. */
export type Changed = { type: LedgerDocument['type']; id: string }

/** What the preload puts on `window.haveFish`. */
export type Bridge = {
  invoke<N extends CommandName>(name: N, input: InputOf<N>): Promise<Wire<Values[N]>>
  /** Calls `listener` after each command that wrote anything. Returns the unsubscribe. */
  onChanged(listener: (changed: Changed[]) => void): () => void
  /** Calls `listener` with an action's id when it is chosen from the menu. Returns the unsubscribe. */
  onAction(listener: (id: string) => void): () => void
  /** Tells main where Undo and Redo would go now, so the menu can name it. */
  setTyping(typing: Typing): void
}

/** Whether Undo and Redo would take back or put back the focused field's typing. */
export type Typing = { undo: boolean; redo: boolean }
