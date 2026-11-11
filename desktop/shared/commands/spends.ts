// What writing down and listing spends asks of main: each command's input, and what it answers.

import type { OriginSource } from '@have-fish/core/documents'
import type { ShapeName } from '@have-fish/core/shapes'
import { z } from 'zod'
import { date, type Money, typed } from './wire'

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

/** `to` or `date` left out: unchanged. */
const edit = z.strictObject({
  id: z.uuid(),
  amount: typed(64),
  description: typed(500),
  to: to.optional(),
  date: date.optional(),
})

export const spendInputs = {
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

export interface SpendValues {
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
}

/** What an undo step of a spend is called. */
export type SpendStep =
  | { kind: 'write'; description: string }
  | { kind: 'edit'; description: string }
  | { kind: 'remove'; description: string }
