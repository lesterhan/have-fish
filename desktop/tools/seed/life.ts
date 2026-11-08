// A person's year, day by day: someone in Toronto, paid in CAD, with family in Taiwan and a
// Wise account for travel. Bills come on their days, spending happens at home, and life events
// interrupt both. Each day draws only on its own randomness, so a later day never changes an
// earlier one.

import { addDays } from '@have-fish/core/calendar-date'
import type { Book, Meta } from './book'
import { addEvents, type Plan } from './events'
import {
  CASH,
  CHEQUING,
  cardForeign,
  ensureChequing,
  LOAN,
  OPENING,
  remit,
  SAVINGS,
  spend,
  transfer,
  VISA,
  WISE_HOLDS,
  wise,
} from './moves'
import { hash32, type Rng } from './random'

export type LifeOptions = {
  /** The first day, with every account's starting balance. */
  start: string
  /** The last day anything is dated. */
  today: string
  /** How many times a year profile's everyday spending, and its pay to match. */
  density: number
  /** The year, counted from 0, that the one-off events fall in: the job, the move, the car. */
  oneOffYear: number
}

export type Day = {
  book: Book
  date: string
  /** Days since the start. */
  n: number
  rng: Rng
  life: Life
}

/** What a day needs to know about the days before it. */
export type Life = {
  options: LifeOptions
  plan: Plan
  /** What the card owed on the 1st, paid on the 22nd. */
  statement: number
  /** CPP and EI taken this calendar year, which stop at the yearly maximum. */
  cppEi: { year: string; cents: number }
  /** Steps a day schedules for a later one: the savings sweep after pay day. */
  later: Map<string, ((d: Day) => void)[]>
}

export const city = (life: Life, date: string) => (date < life.plan.moveDate ? 'Toronto' : 'Ottawa')

export function live(book: Book, options: LifeOptions): Life {
  const plan = addEvents(options)
  const life: Life = {
    options,
    plan,
    statement: 0,
    cppEi: { year: '', cents: 0 },
    later: new Map(),
  }
  openAccounts(book, options.start)
  for (let date = options.start, n = 0; date <= options.today; date = addDays(date, 1), n++) {
    const day: Day = { book, date, n, rng: book.rng(date, 'day'), life }
    recurring(day)
    if (!plan.away.some(([from, to]) => from <= date && date <= to)) everyday(day)
    for (const step of plan.steps.get(date) ?? []) step(day)
    for (const step of life.later.get(date) ?? []) step(day)
    if (date.endsWith('-01')) life.statement = -book.balance(VISA, 'CAD')
  }
  return life
}

/** Every account, each with its starting balance on `start`. */
export function openAccounts(book: Book, start: string) {
  book.open(CHEQUING, 'bank', 'CAD', start)
  book.open(SAVINGS, 'bank', 'CAD', start)
  book.open(VISA, 'card', 'CAD', start)
  book.open(LOAN, 'loan', 'CAD', start)
  // The app makes the wallet itself, for a spend with nothing to pay from.
  book.open(CASH, 'cash', null, start, true)
  for (const cur of WISE_HOLDS) book.open(wise(cur), 'bank', cur, start)

  const starts: [string, number, string][] = [
    [CHEQUING, 320_000, 'CAD'],
    [SAVINGS, 1_850_000, 'CAD'],
    [VISA, -124_018, 'CAD'],
    [LOAN, -1_680_000, 'CAD'],
    [CASH, 6_000, 'CAD'],
    [CASH, 300_000, 'JPY'],
    [CASH, 80_000, 'NTD'],
    [wise('CAD'), 45_000, 'CAD'],
    [wise('EUR'), 8_520, 'EUR'],
    [wise('USD'), 4_000, 'USD'],
  ]
  for (const [path, cents, cur] of starts) {
    book.add(
      start,
      'Starting balance',
      [
        [path, cents, cur],
        [OPENING, -cents, cur],
      ],
      { shape: 'opening' },
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Recurring: what a recurring-charges feature should find.

const dom = (date: string) => Number(date.slice(8, 10))
const month = (date: string) => Number(date.slice(5, 7))
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
const lastOfMonth = (date: string) => addDays(date, 1).endsWith('-01')

function recurring(d: Day) {
  const { book, date, n, life } = d
  const r = book.rng(date, 'recurring')
  const where = city(life, date)
  const year = Math.floor(n / 365)
  const inYear = n % 365
  const final = year === life.options.oneOffYear
  const bill = (series: string): Meta => ({ series })

  rent(d)
  pay(d)

  // Mid-month, a day or two either way.
  if (dom(date) === 15 + (hash32(date.slice(0, 7)) % 3)) {
    const winter = [12, 1, 2, 3].includes(month(date))
    const summer = [6, 7, 8].includes(month(date))
    const cents = winter ? r.cents(95, 140) : summer ? r.cents(90, 130) : r.cents(68, 95)
    const name = where === 'Toronto' ? 'Toronto Hydro' : 'Hydro Ottawa'
    spend(book, date, CHEQUING, 'expenses:housing:hydro', cents, name, { series: 'Hydro' })
  }
  if (dom(date) === 18) {
    const heating = [11, 12, 1, 2, 3].includes(month(date))
    const cents = heating ? r.cents(110, 175) : r.cents(28, 40)
    spend(book, date, CHEQUING, 'expenses:housing:heating', cents, 'Enbridge Gas', {
      series: 'Enbridge Gas',
    })
  }
  if (dom(date) === 20) {
    spend(book, date, VISA, 'expenses:housing:internet', 7_500, 'Start.ca', bill('Internet'))
  }
  if (dom(date) === 5) {
    const cents = final && inYear >= 175 ? 5_000 : 4_500
    spend(book, date, VISA, 'expenses:phone', cents, 'Fido', bill('Phone'))
  }
  if (dom(date) === 12) {
    const cents = !final || inYear < 120 ? 1_899 : 2_099
    spend(book, date, VISA, 'expenses:subscriptions', cents, 'Netflix', bill('Netflix'))
  }
  if (dom(date) === 22) {
    spend(book, date, VISA, 'expenses:subscriptions', 1_299, 'Spotify', bill('Spotify'))
  }
  // Cancelled in the spring: a series that stops.
  if (dom(date) === 8 && (!final || inYear < 150)) {
    spend(book, date, VISA, 'expenses:subscriptions', 1_499, 'Disney+', bill('Disney+'))
  }
  if (dom(date) === 9) {
    spend(book, date, VISA, 'expenses:subscriptions', 399, 'iCloud+', bill('iCloud+'))
  }
  if (dom(date) === 3) {
    cardForeign(book, date, 'USD', 500, 'expenses:subscriptions', 'Fastmail', bill('Fastmail'))
  }
  // Every other Monday in Toronto; monthly at a different gym in Ottawa.
  if (where === 'Toronto' && weekday(date) === 1 && Math.floor(n / 7) % 2 === 0) {
    spend(book, date, VISA, 'expenses:health:gym', 2_999, 'GoodLife Fitness', bill('Gym'))
  }
  if (where === 'Ottawa' && dom(date) === 3) {
    spend(book, date, VISA, 'expenses:health:gym', 6_400, 'Ottawa Athletic Club', bill('Gym'))
  }
  if (where === 'Ottawa' && dom(date) === 1) {
    spend(book, date, VISA, 'expenses:transport:transit', 13_500, 'OC Transpo pass', {
      series: 'OC Transpo pass',
    })
  }
  if (dom(date) === 28) {
    const cents = where === 'Toronto' ? 16_240 : 14_890
    spend(book, date, CHEQUING, 'expenses:car:insurance', cents, 'Intact Insurance', {
      series: 'Car insurance',
    })
  }
  if (dom(date) === 15) carLoan(d)
  if (dom(date) === 25) {
    remit(book, date, 'NTD', 1_000_000, 'expenses:family:support', 'Wise to Mom and Dad', {
      series: 'Family support',
    })
  }
  if (dom(date) === 22 && life.statement > 0) {
    transfer(book, date, CHEQUING, VISA, life.statement, 'Visa payment', {
      shape: 'card-payoff',
      series: 'Visa payment',
    })
  }
  if (lastOfMonth(date)) {
    const interest = Math.round((book.balance(SAVINGS, 'CAD') * 0.0275) / 12)
    if (interest > 0) {
      book.add(
        date,
        'EQ Bank interest',
        [
          [SAVINGS, interest, 'CAD'],
          ['income:interest', -interest, 'CAD'],
        ],
        { shape: 'interest', series: 'Savings interest' },
      )
    }
  }
  if (inYear === 74) {
    spend(book, date, VISA, 'expenses:subscriptions', 9_900, 'Amazon Prime', bill('Amazon Prime'))
  }
  if (inYear === 232) {
    cardForeign(book, date, 'USD', 1_500, 'expenses:subscriptions', 'Domain renewal', {
      series: 'Domain renewal',
    })
  }
  if (inYear === 281) {
    spend(book, date, VISA, 'expenses:shopping', 7_345, 'Costco membership', {
      series: 'Costco membership',
    })
  }
}

/**
 * On the 1st. Toronto's rent rises 2.5% a year; the last month there is the deposit paid years
 * ago, and the first in Ottawa was paid with the lease, so two 1sts have no rent.
 */
function rent(d: Day) {
  const { book, date, n, life } = d
  if (dom(date) !== 1) return
  const move = life.plan.moveDate
  const lastToronto = addDays(move, -1).slice(0, 7)
  if (date.slice(0, 7) === lastToronto || date === move) return
  if (date < move) {
    const rises = Math.floor((n - 110) / 365) - life.options.oneOffYear
    const cents = Math.round(235_000 * 1.025 ** rises)
    spend(book, date, CHEQUING, 'expenses:housing:rent', cents, 'Rent, Harbourview Property', {
      series: 'Rent',
    })
  } else {
    spend(book, date, CHEQUING, 'expenses:housing:rent', 195_000, 'Rent, Glebe Lofts', {
      series: 'Rent',
    })
  }
}

/** Every other Thursday at the old job, every other Friday at the new one: split on the stub. */
function pay(d: Day) {
  const { book, date, life } = d
  const { lastOld, firstNew } = life.plan.job
  const scale = 1 + (life.options.density - 1) * 0.55
  const old = date <= lastOld && weekday(date) === 4 && every14(life.options.start, date, 4)
  const fresh = date >= firstNew && (Date.parse(date) - Date.parse(firstNew)) % (14 * 864e5) === 0
  if (!old && !fresh) return
  const gross = Math.round((old ? 420_000 : 465_000) * scale)
  const employer = old ? 'northwind-studio' : 'maplewood-labs'
  const year = date.slice(0, 4)
  if (life.cppEi.year !== year) life.cppEi = { year, cents: 0 }
  const cppEi = Math.max(
    0,
    Math.min(Math.round(gross * 0.0759), Math.round(520_000 * scale) - life.cppEi.cents),
  )
  life.cppEi.cents += cppEi
  const tax = Math.round(gross * 0.24)
  const net = gross - tax - cppEi
  book.add(
    date,
    old ? 'Northwind Studio payroll' : 'Maplewood Labs payroll',
    [
      [CHEQUING, net, 'CAD'],
      ['expenses:tax:income', tax, 'CAD'],
      ...(cppEi > 0 ? [['expenses:tax:cpp-ei', Math.round(cppEi), 'CAD'] as const] : []),
      [`income:salary:${employer}`, -(net + tax + Math.round(cppEi)), 'CAD'],
    ],
    {
      shape: 'pay-split',
      series: 'Payroll',
      ...(cppEi === 0 && { note: 'CPP and EI have hit the yearly maximum: no line for them' }),
    },
  )
  const sweep = addDays(date, 1)
  if (book.reached(sweep)) {
    later(life, sweep, ({ book: b }) =>
      transfer(b, sweep, CHEQUING, SAVINGS, Math.round(40_000 * scale), 'To savings', {
        series: 'Savings',
      }),
    )
  }
}

/** Runs `step` on `date`, a day still to come. */
export function later(life: Life, date: string, step: (d: Day) => void) {
  const steps = life.later.get(date) ?? []
  steps.push(step)
  life.later.set(date, steps)
}

/** Whether `date` is a whole number of fortnights after the first `day` of the week from `start`. */
function every14(start: string, date: string, day: number) {
  let first = start
  while (weekday(first) !== day) first = addDays(first, 1)
  return Math.round((Date.parse(date) - Date.parse(first)) / 864e5) % 14 === 0
}

/** The payment covers the month's interest first; the last one is whatever's left. */
function carLoan(d: Day) {
  const { book, date } = d
  const owed = -book.balance(LOAN, 'CAD')
  if (owed <= 0) return
  const interest = Math.round((owed * 0.0599) / 12)
  const principal = Math.min(41_255 - interest, owed)
  ensureChequing(book, date, principal + interest)
  book.add(
    date,
    'Car loan payment',
    [
      [LOAN, principal, 'CAD'],
      ['expenses:car:loan-interest', interest, 'CAD'],
      [CHEQUING, -(principal + interest), 'CAD'],
    ],
    {
      shape: 'loan-payment',
      series: 'Car loan',
      ...(principal === owed && { note: 'The last payment: the loan is paid off' }),
    },
  )
}

// ---------------------------------------------------------------------------------------------
// Everyday spending at home.

const PLACES = {
  Toronto: {
    coffee: ['Pilot Coffee Roasters', "Balzac's Coffee", 'Tim Hortons', 'Dineen Coffee'],
    groceries: ['Loblaws', 'No Frills', 'Farm Boy', 'Metro', 'T&T Supermarket'],
    restaurants: ['Pai Northern Thai', 'Banh Mi Boys', 'Seven Lives Tacos', 'Kinka Izakaya'],
    fun: ['Cineplex', 'TIFF Lightbox', 'Ticketmaster', 'Steam'],
  },
  Ottawa: {
    coffee: ['Bridgehead', 'Happy Goat Coffee', 'Tim Hortons', 'Little Victories'],
    groceries: ['Farm Boy', 'Loblaws', 'Metro', 'Herb & Spice', 'T&T Supermarket'],
    restaurants: ['Shawarma Palace', 'Supply and Demand', 'Pho Bo Ga La', 'Ramen Isshin'],
    fun: ['Cineplex', 'Mayfair Theatre', 'Ticketmaster', 'Steam'],
  },
} as const

const SHOPS = ['Amazon.ca', 'Canadian Tire', 'Uniqlo', 'Indigo', 'MEC', 'Best Buy', 'Winners']

/** `x` whole times, and once more with the chance of what's left over. */
const times = (rng: Rng, x: number) => Math.floor(x) + (rng.chance(x - Math.floor(x)) ? 1 : 0)

function everyday(d: Day) {
  const { book, date, rng, life } = d
  const places = PLACES[city(life, date)]
  const workday = weekday(date) >= 1 && weekday(date) <= 5
  const often = (p: number) => times(rng, p * life.options.density)
  // Most of it on the card, some by debit.
  const card = () => (rng.chance(0.75) ? VISA : CHEQUING)
  const at = (from: string, category: string, cents: number, name: string) =>
    spend(book, date, from, category, cents, name)

  for (let i = often(workday ? 0.7 : 0.35); i > 0; i--) {
    at(VISA, 'expenses:food:coffee', rng.cents(3.6, 7.8), rng.pick(places.coffee))
  }
  for (let i = often(0.33); i > 0; i--) {
    at(card(), 'expenses:food:groceries', rng.cents(14, 165), rng.pick(places.groceries))
  }
  for (let i = often(weekday(date) >= 5 ? 0.6 : 0.25); i > 0; i--) {
    at(VISA, 'expenses:food:restaurants', rng.cents(18, 96), rng.pick(places.restaurants))
  }
  for (let i = often(0.14); i > 0; i--) {
    const app = rng.pick(['Uber Eats', 'DoorDash', 'SkipTheDishes'])
    at(VISA, 'expenses:food:takeout', rng.cents(24, 58), app)
  }
  if (city(life, date) === 'Toronto') {
    for (let i = often(workday ? 0.22 : 0.05); i > 0; i--) {
      at(VISA, 'expenses:transport:transit', rng.pick([2_000, 4_000]), 'Presto top-up')
    }
  }
  for (let i = often(0.1); i > 0; i--) {
    const station = rng.pick(['Petro-Canada', 'Esso', 'Shell', 'Costco Gas'])
    at(VISA, 'expenses:transport:gas', rng.cents(45, 82), station)
  }
  for (let i = often(0.09); i > 0; i--) {
    const shop = rng.pick(SHOPS)
    const from = card()
    const price = rng.cents(9, 140)
    at(from, 'expenses:shopping', price, shop)
    // Now and then something goes back, in whole or in part.
    const back = addDays(date, rng.int(3, 12))
    const cents = rng.chance(0.5) ? price : Math.round(price / 2)
    if (rng.chance(0.12) && book.reached(back)) {
      later(life, back, ({ book: b }) =>
        b.add(
          back,
          `${shop} refund`,
          [
            [from, cents, 'CAD'],
            ['expenses:shopping', -cents, 'CAD'],
          ],
          { shape: 'refund', note: `Back from the ${shop} spend on ${date}` },
        ),
      )
    }
  }
  for (let i = often(0.05); i > 0; i--) {
    const store = rng.pick(['Shoppers Drug Mart', 'Rexall'])
    at(card(), 'expenses:health:pharmacy', rng.cents(6, 48), store)
  }
  for (let i = often(weekday(date) >= 5 ? 0.15 : 0.04); i > 0; i--) {
    at(VISA, 'expenses:entertainment', rng.cents(12, 85), rng.pick(places.fun))
  }
  for (let i = often(0.06); i > 0; i--) {
    const [name, category] = rng.pick([
      ['Farmers market', 'expenses:food:groceries'],
      ['Haircut', 'expenses:personal'],
      ['Parking meter', 'expenses:transport:parking'],
    ] as const)
    spend(book, date, CASH, category, rng.cents(4, 32), name)
  }
  // Sometimes the category is left empty: these report as unsorted.
  if (rng.chance(0.012 * life.options.density)) {
    spend(book, date, CASH, 'expenses:unsorted', rng.cents(3, 20), 'Corner store', {
      note: 'No category given: reports count it as unsorted',
    })
  }
  // A Costco run once a month, on the first Saturday from the 10th: one receipt, three categories.
  if (weekday(date) === 6 && dom(date) >= 10 && dom(date) <= 16) {
    const food = rng.cents(90, 210)
    const home = rng.cents(25, 80)
    const health = rng.cents(10, 40)
    book.add(
      date,
      'Costco',
      [
        ['expenses:food:groceries', food, 'CAD'],
        ['expenses:household', home, 'CAD'],
        ['expenses:health:pharmacy', health, 'CAD'],
        [VISA, -(food + home + health), 'CAD'],
      ],
      { shape: 'split' },
    )
  }
}
