// The ways money moves, each as the postings a bank or Wise statement implies. Every one keeps
// the accounts it draws on above zero: it tops them up first, as a person would.

import { addDays } from '@have-fish/core/calendar-date'
import { CONVERSION, OPENING, UNSORTED, WALLET } from '@have-fish/core/own-accounts'
import type { Book, Entry, Meta } from './book'
import { type Cur, convert } from './rates'

export const CHEQUING = 'assets:bank:chequing'
export const SAVINGS = 'assets:bank:savings'
export const VISA = 'liabilities:visa'
export const LOAN = 'liabilities:loan:car'
export const CASH = WALLET.path
export const FX = CONVERSION.path
export const OPENING_PATH = OPENING.path
export const UNSORTED_PATH = UNSORTED.path
export const FX_FEES = 'expenses:fees:fx'
export const ATM_FEES = 'expenses:fees:atm'

/** The balances Wise holds. NTD and CNY it converts to on the spot, from CAD. */
export const WISE_HOLDS = ['CAD', 'USD', 'EUR', 'CZK', 'JPY'] as const satisfies readonly Cur[]
export const wise = (cur: Cur) => `assets:wise:${cur.toLowerCase()}`
const holds = (cur: Cur) => (WISE_HOLDS as readonly Cur[]).includes(cur)

/** Up to the next multiple of `step`. */
const ceilTo = (cents: number, step: number) => Math.ceil(cents / step) * step

/** Wise's fee on converting `cad` cents: about half a percent, never under a quarter. */
const wiseFee = (cad: number) => Math.max(Math.round(cad * 0.0057), 25)

/** The card's 2.5% foreign-transaction markup. */
const CARD_MARKUP = 1.025

/** A spend from one account into a category, in one currency. */
export function spend(
  book: Book,
  date: string,
  from: string,
  category: string,
  cents: number,
  description: string,
  meta: Meta = {},
  cur: Cur = 'CAD',
): Entry {
  if (from === CHEQUING) ensureChequing(book, date, cents, meta)
  if (from === CASH) ensureCash(book, date, cur, cents, meta)
  return book.add(
    date,
    description,
    [
      [category, cents, cur],
      [from, -cents, cur],
    ],
    meta,
  )
}

/** Money between two of my accounts, in one currency. */
export function transfer(
  book: Book,
  date: string,
  from: string,
  to: string,
  cents: number,
  description: string,
  meta: Meta = {},
): Entry {
  if (from === CHEQUING) ensureChequing(book, date, cents, meta)
  if (from === wise('CAD')) ensureWiseCad(book, date, cents, meta)
  return book.add(
    date,
    description,
    [
      [to, cents, 'CAD'],
      [from, -cents, 'CAD'],
    ],
    { shape: 'transfer', ...meta },
  )
}

/** Keeps chequing a few hundred above what's about to leave it, from savings. */
export function ensureChequing(book: Book, date: string, cents: number, meta: Meta = {}) {
  const short = cents + 30_000 - book.balance(CHEQUING, 'CAD')
  if (short <= 0) return
  book.add(
    date,
    'Transfer from savings',
    [
      [CHEQUING, ceilTo(short, 50_000), 'CAD'],
      [SAVINGS, -ceilTo(short, 50_000), 'CAD'],
    ],
    { shape: 'transfer', tags: meta.tags ?? [] },
  )
}

/** Tops Wise's CAD balance up from chequing, by bank transfer, when it can't cover `cents`. */
export function ensureWiseCad(book: Book, date: string, cents: number, meta: Meta = {}) {
  const short = cents - book.balance(wise('CAD'), 'CAD')
  if (short <= 0) return
  const amount = Math.max(ceilTo(short, 25_000), 50_000)
  ensureChequing(book, date, amount, meta)
  book.add(
    date,
    'Wise top-up',
    [
      [wise('CAD'), amount, 'CAD'],
      [CHEQUING, -amount, 'CAD'],
    ],
    { shape: 'transfer', tags: meta.tags ?? [] },
  )
}

/** Cash in hand for a spend: CAD from a chequing ATM, anything else from a Wise card abroad. */
function ensureCash(book: Book, date: string, cur: Cur, cents: number, meta: Meta) {
  const short = cents - book.balance(CASH, cur)
  if (short <= 0) return
  if (cur === 'CAD') {
    const amount = ceilTo(Math.max(short, 6_000), 2_000)
    transfer(book, date, CHEQUING, CASH, amount, 'ATM withdrawal', { tags: meta.tags ?? [] })
    return
  }
  // Notes, as an ATM gives them: at least about 100 CAD's worth.
  const step = ATM_NOTE[cur]
  const least = convert('CAD', cur, 10_000, date)
  atm(book, date, cur, ceilTo(Math.max(short, least), step), { tags: meta.tags ?? [] })
}

/** The note an ATM abroad hands out, in cents. */
const ATM_NOTE: Record<Cur, number> = {
  CAD: 2_000,
  USD: 2_000,
  EUR: 5_000,
  CZK: 50_000,
  CNY: 10_000,
  JPY: 100_000,
  NTD: 100_000,
}

/** What a foreign ATM charges, in its own money. */
const ATM_FEE: Record<Cur, number> = {
  CAD: 300,
  USD: 350,
  EUR: 250,
  CZK: 6_000,
  CNY: 3_000,
  JPY: 22_000,
  NTD: 10_000,
}

/** Wise's own conversion: CAD into a balance it holds, with its fee. */
export function wiseConvert(book: Book, date: string, to: Cur, cents: number, meta: Meta = {}) {
  const cad = convert(to, 'CAD', cents, date)
  const fee = wiseFee(cad)
  ensureWiseCad(book, date, cad + fee, meta)
  return book.add(
    date,
    `Wise: CAD to ${to}`,
    [
      [wise('CAD'), -(cad + fee), 'CAD'],
      [FX_FEES, fee, 'CAD'],
      [FX, cad, 'CAD'],
      [FX, -cents, to],
      [wise(to), cents, to],
    ],
    { shape: 'wise-conversion', ...meta },
  )
}

/**
 * A Wise card spend. It draws on the balance in the spend's currency first, and converts what's
 * left from CAD, with the fee: the same postings Wise's statement shows.
 */
export function wiseSpend(
  book: Book,
  date: string,
  cur: Cur,
  cents: number,
  category: string,
  description: string,
  meta: Meta = {},
): Entry {
  if (cur === 'CAD') {
    ensureWiseCad(book, date, cents, meta)
    return book.add(
      date,
      description,
      [
        [category, cents, 'CAD'],
        [wise('CAD'), -cents, 'CAD'],
      ],
      { shape: 'spend', ...meta },
    )
  }
  const have = holds(cur) ? Math.max(book.balance(wise(cur), cur), 0) : 0
  if (have >= cents) {
    return book.add(
      date,
      description,
      [
        [category, cents, cur],
        [wise(cur), -cents, cur],
      ],
      { shape: 'wise-foreign', ...meta },
    )
  }
  const rest = cents - have
  const cad = convert(cur, 'CAD', rest, date)
  const fee = wiseFee(cad)
  ensureWiseCad(book, date, cad + fee, meta)
  return book.add(
    date,
    description,
    [
      [category, cents, cur],
      ...(have > 0 ? [[wise(cur), -have, cur] as const] : []),
      [wise('CAD'), -(cad + fee), 'CAD'],
      [FX_FEES, fee, 'CAD'],
      [FX, cad, 'CAD'],
      [FX, -rest, cur],
    ],
    { shape: 'wise-mixed', ...meta },
  )
}

/**
 * The CAD card abroad. By default the bank's rate carries its 2.5% inside it. With `fee: 'line'`
 * the statement shows the fee as a line of the same transaction; with `fee: 'later'` it comes the
 * next day as a transaction of its own.
 */
export function cardForeign(
  book: Book,
  date: string,
  cur: Cur,
  cents: number,
  category: string,
  description: string,
  meta: Meta & { fee?: 'rate' | 'line' | 'later' } = {},
): Entry {
  const { fee: how = 'rate', ...rest } = meta
  const market = convert(cur, 'CAD', cents, date)
  const cad = how === 'rate' ? Math.round(market * CARD_MARKUP) : market
  const fee = how === 'line' ? Math.round(market * (CARD_MARKUP - 1)) : 0
  const entry = book.add(
    date,
    description,
    [
      [category, cents, cur],
      [FX, -cents, cur],
      [FX, cad, 'CAD'],
      ...(fee > 0 ? [[FX_FEES, fee, 'CAD'] as const] : []),
      [VISA, -(cad + fee), 'CAD'],
    ],
    { shape: how === 'line' ? 'card-foreign-fee' : 'card-foreign', ...rest },
  )
  if (how === 'later' && book.reached(addDays(date, 1))) {
    const later = Math.round(market * (CARD_MARKUP - 1))
    book.add(
      addDays(date, 1),
      'Foreign transaction fee',
      [
        [FX_FEES, later, 'CAD'],
        [VISA, -later, 'CAD'],
      ],
      {
        shape: 'card-fee-later',
        tags: rest.tags ?? [],
        note: `The card's 2.5% on "${description}", a day later`,
      },
    )
  }
  return entry
}

/** Alipay on the CAD card: over 200 CNY it adds 3%, in CNY, before the card converts it. */
export function alipay(
  book: Book,
  date: string,
  cents: number,
  category: string,
  description: string,
  meta: Meta = {},
): Entry {
  if (cents <= 20_000) return cardForeign(book, date, 'CNY', cents, category, description, meta)
  const fee = Math.round(cents * 0.03)
  const cad = Math.round(convert('CNY', 'CAD', cents + fee, date) * CARD_MARKUP)
  return book.add(
    date,
    description,
    [
      [category, cents, 'CNY'],
      [FX_FEES, fee, 'CNY'],
      [FX, -(cents + fee), 'CNY'],
      [FX, cad, 'CAD'],
      [VISA, -cad, 'CAD'],
    ],
    { shape: 'alipay-fee', ...meta },
  )
}

/** A Wise card at an ATM abroad: CAD converted, Wise's fee, and the ATM's own fee in local money. */
export function atm(book: Book, date: string, cur: Cur, cents: number, meta: Meta = {}): Entry {
  const atmFee = ATM_FEE[cur]
  const cad = convert(cur, 'CAD', cents + atmFee, date)
  const fee = wiseFee(cad) + 150
  ensureWiseCad(book, date, cad + fee, meta)
  return book.add(
    date,
    `ATM withdrawal, ${cur}`,
    [
      [CASH, cents, cur],
      [ATM_FEES, atmFee, cur],
      [FX, -(cents + atmFee), cur],
      [FX, cad, 'CAD'],
      [FX_FEES, fee, 'CAD'],
      [wise('CAD'), -(cad + fee), 'CAD'],
    ],
    { shape: 'atm-abroad', ...meta },
  )
}

/** Cash spent abroad, from the wallet; it takes out more at an ATM first if it's short. */
export function cashForeign(
  book: Book,
  date: string,
  cur: Cur,
  cents: number,
  category: string,
  description: string,
  meta: Meta = {},
): Entry {
  return spend(
    book,
    date,
    CASH,
    category,
    cents,
    description,
    { shape: 'cash-foreign', ...meta },
    cur,
  )
}

/** Money sent through Wise to someone else's account in `cur`, converted from CAD. */
export function remit(
  book: Book,
  date: string,
  cur: Cur,
  cents: number,
  category: string,
  description: string,
  meta: Meta = {},
): Entry {
  const cad = convert(cur, 'CAD', cents, date)
  const fee = wiseFee(cad) + 99
  ensureWiseCad(book, date, cad + fee, meta)
  return book.add(
    date,
    description,
    [
      [category, cents, cur],
      [FX, -cents, cur],
      [FX, cad, 'CAD'],
      [FX_FEES, fee, 'CAD'],
      [wise('CAD'), -(cad + fee), 'CAD'],
    ],
    { shape: 'remittance', ...meta },
  )
}
