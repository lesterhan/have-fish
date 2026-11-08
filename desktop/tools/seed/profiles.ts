// The ledgers the tool can make, by name.

import { addDays } from '@have-fish/core/calendar-date'
import { Book, type BookOptions } from './book'
import { edges } from './edge'
import { finish } from './finish'
import { live, openAccounts } from './life'

export type Built = { book: Book; start: string } | null

export type Profile = {
  about: string
  /** Whether `top-up` can carry it forward to a later today. */
  grows: boolean
  /** False when there's no ledger file to write: the app makes its own. */
  ledger: boolean
  /** Builds it, from `start` when a top-up names the first seed's, else its own. */
  build(options: BookOptions, start?: string): Built
}

/** A year or more of life, ending `today`. */
function lifeOf(years: number, density: number): Profile['build'] {
  return (options, start = addDays(options.today, -(365 * years - 1))) => {
    const book = new Book(options)
    const life = live(book, { start, today: options.today, density, oneOffYear: years - 1 })
    finish(book, life)
    return { book, start }
  }
}

export const PROFILES: Record<string, Profile> = {
  year: {
    about: 'A year of life ending today: bills, pay, trips, a move. About 1,300 transactions.',
    grows: true,
    ledger: true,
    build: lifeOf(1, 1.3),
  },
  decade: {
    about: 'Ten years at the performance budget: about 50,000 transactions.',
    grows: true,
    ledger: true,
    build: lifeOf(10, 6.8),
  },
  edge: {
    about: 'Only the odd cases, about 70, each named for what it tests.',
    grows: false,
    ledger: true,
    build(options) {
      const book = new Book(options)
      edges(book, options.today)
      return { book, start: addDays(options.today, -21) }
    },
  },
  starter: {
    about: 'Every account with its starting balance, and nothing spent yet.',
    grows: false,
    ledger: true,
    build(options) {
      const book = new Book(options)
      openAccounts(book, options.today)
      return { book, start: options.today }
    },
  },
  empty: {
    about: 'No ledger at all: the app makes one on its first start.',
    grows: false,
    ledger: false,
    build: () => null,
  },
}
