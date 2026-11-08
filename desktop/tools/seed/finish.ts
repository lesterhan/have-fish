// What happens to a ledger after the spending: the card's statements are imported each month,
// and a few entries are fixed the next day or found saved twice.

import { addDays } from '@have-fish/core/calendar-date'
import type { TransactionDoc } from '@have-fish/core/documents'
import { cents, format } from '@have-fish/core/money'
import { type Book, dayMs, type Entry } from './book'
import { city, type Life } from './life'
import { VISA } from './moves'
import { hash32 } from './random'

const HOUR_MS = 3_600_000

export function finish(book: Book, life: Life) {
  imports(book, life)
  mistakes(book)
}

/**
 * The card's plain spends come from its CSV, imported on the 3rd of the next month. What I typed
 * on a trip, and anything in another currency, stays as I typed it.
 */
function imports(book: Book, life: Life) {
  const visa = book.accounts.get(VISA)?.id
  const months = new Map<string, Entry[]>()
  for (const e of book.entries) {
    const { postings, origin, date } = e.doc
    if (postings.length !== 2 || e.tags.length > 0 || origin.source !== 'manual') continue
    if (!postings.some((p) => p.accountId === visa)) continue
    const list = months.get(date.slice(0, 7)) ?? []
    list.push(e)
    months.set(date.slice(0, 7), list)
  }
  for (const [month, list] of months) {
    const day = addDays(`${month}-01`, 33).slice(0, 8)
    const importDay = `${day}03`
    const at = dayMs(importDay) + 23 * HOUR_MS
    if (!book.reached(importDay) || at > book.options.nowMs) continue
    list.sort((a, b) => a.doc.date.localeCompare(b.doc.date))
    list.forEach((e, i) => {
      e.doc = {
        ...e.doc,
        origin: {
          source: 'import',
          createdAt: at,
          deviceId: book.options.deviceId,
          file: `visa-${month}.csv`,
          line: i + 2,
          text: bankText(e, city(life, e.doc.date)),
        },
      }
      e.final = e.doc
    })
  }
}

/** The description as a card statement writes it: capitals, cut short, with the city. */
function bankText(e: Entry, where: string): string {
  if (e.shape === 'card-payoff') return 'PAYMENT - THANK YOU'
  const name = e.doc.description
    .replace(/ refund$/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 &.'*+-]/g, '')
    .slice(0, 22)
  const square = e.doc.description.includes('Coffee') && hash32(e.doc.id) % 2 === 0
  const text = `${square ? 'SQ *' : ''}${name}`.padEnd(25)
  return e.shape === 'refund' ? `${text} RETURN` : `${text} ${where.toUpperCase()} ON`
}

/**
 * Some typed spends are saved wrong and fixed the next day, or saved twice and the copy deleted.
 * Some imported ones keep the bank's words until they're renamed.
 */
function mistakes(book: Book) {
  for (const e of [...book.entries]) {
    const { postings, origin, description, id } = e.doc
    const at = origin.createdAt + 26 * HOUR_MS
    if (postings.length !== 2 || at > book.options.nowMs) continue
    if (!book.reached(addDays(e.doc.date, 1))) continue
    const pick = hash32(`mistake:${id}`) % 40
    if (origin.source === 'import' && hash32(`rename:${id}`) % 80 === 0) {
      book.mistype(e, 'description', { ...e.doc, description: origin.text.trim() }, at)
      continue
    }
    if (e.shape !== 'spend' || origin.source !== 'manual') continue
    if (pick === 0) {
      book.mistype(e, 'amount', withAmount(e.doc, mistyped(cents(postings[0]?.amount ?? '0'))), at)
    } else if (pick === 1 && /^[A-Za-z]{4}/.test(description)) {
      const typo = `${description[0]}${description[2]}${description[1]}${description.slice(3)}`
      book.mistype(e, 'description', { ...e.doc, description: typo }, at)
    } else if (pick === 2) {
      book.deletedCopy(e, at)
    }
  }
}

/** Two digits swapped, as fingers do: 45.80 typed as 54.80. */
function mistyped(c: number): number {
  const s = String(c)
  if (s.length < 4 || s[s.length - 3] === s[s.length - 4]) return c * 10
  return Number(`${s.slice(0, -4)}${s[s.length - 3]}${s[s.length - 4]}${s.slice(-2)}`)
}

/** `doc` with its two legs moving `c` cents instead. */
function withAmount(doc: TransactionDoc, c: number): TransactionDoc {
  return {
    ...doc,
    postings: doc.postings.map((p) => ({
      ...p,
      amount: format(cents(p.amount) > 0 ? c : -c),
    })),
  }
}
