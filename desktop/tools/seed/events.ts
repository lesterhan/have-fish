// The year's events: trips, a move, a car repair, a wedding booked ahead. Each lands on days
// counted from the year's start, and carries tags for the tag feature still to come. Trips come
// round every year; the job, the move, the car and the wedding happen once, in `oneOffYear`.

import { addDays } from '@have-fish/core/calendar-date'
import type { Book } from './book'
import type { Day, LifeOptions } from './life'
import {
  alipay,
  atm,
  CASH,
  CHEQUING,
  cardForeign,
  cashForeign,
  SAVINGS,
  spend,
  transfer,
  VISA,
  wise,
  wiseConvert,
  wiseSpend,
} from './moves'
import { rateOn } from './rates'

export type Step = (d: Day) => void

export type Plan = {
  steps: Map<string, Step[]>
  /** Days away from home, both ends included, when there's no everyday spending. */
  away: [string, string][]
  /** The first day in Ottawa: the 1st of a month. */
  moveDate: string
  job: { lastOld: string; firstNew: string }
}

export function addEvents(options: LifeOptions): Plan {
  const { start } = options
  const yearOf = (k: number) => addDays(start, 365 * k)
  const once = yearOf(options.oneOffYear)
  const plan: Plan = {
    steps: new Map(),
    away: [],
    moveDate: firstOfMonthFrom(addDays(once, 262)),
    job: { lastOld: addDays(once, 255), firstNew: nextFriday(addDays(once, 279)) },
  }
  const years = Math.ceil((Date.parse(options.today) - Date.parse(start)) / (365 * 864e5)) + 1
  for (let k = 0; k < years; k++) {
    const base = yearOf(k)
    nyc(plan, base)
    taiwan(plan, base)
    china(plan, base)
    berlin(plan, base)
  }
  fixCar(plan, once)
  move(plan, once)
  prague(plan, once)
  oneCent(plan, once)
  return plan
}

function nextFriday(date: string) {
  let d = date
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 5) d = addDays(d, 1)
  return d
}

function firstOfMonthFrom(date: string) {
  let d = date
  while (!d.endsWith('-01')) d = addDays(d, 1)
  return d
}

/** Puts `step` on the day `offset` days from `base`. */
function on(plan: Plan, base: string, offset: number, step: Step) {
  const date = addDays(base, offset)
  const steps = plan.steps.get(date) ?? []
  steps.push(step)
  plan.steps.set(date, steps)
}

const away = (plan: Plan, base: string, from: number, to: number) =>
  plan.away.push([addDays(base, from), addDays(base, to)])

const yearAt = (base: string, offset: number) => addDays(base, offset).slice(0, 4)

/** Spends on each day of a trip: `count` of them, each drawn from `make`. */
function daily(
  plan: Plan,
  base: string,
  from: number,
  to: number,
  count: [number, number],
  make: (d: Day, book: Book) => void,
) {
  for (let offset = from; offset <= to; offset++) {
    on(plan, base, offset, (d) => {
      const r = d.book.rng(d.date, 'trip')
      for (let i = r.int(...count); i > 0; i--) make({ ...d, rng: r }, d.book)
    })
  }
}

// ---------------------------------------------------------------------------------------------

/** New York before the holidays: USD from Wise, a hotel that runs the balance out. */
function nyc(plan: Plan, base: string) {
  const tags = [`#nyc-holidays-${yearAt(base, 38)}`]
  on(plan, base, 20, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:travel:flights', 77_800, 'Porter Airlines, YTZ to EWR', {
      tags,
      note: 'Two return tickets',
    }),
  )
  on(plan, base, 36, ({ book, date }) => wiseConvert(book, date, 'USD', 50_000, { tags }))
  away(plan, base, 38, 41)
  on(plan, base, 38, ({ book, date }) =>
    wiseSpend(book, date, 'USD', 61_240, 'expenses:travel:lodging', 'Pod Times Square, 3 nights', {
      tags,
      note: 'More than the USD balance: Wise converts the rest from CAD',
    }),
  )
  on(plan, base, 39, ({ book, date }) =>
    cardForeign(book, date, 'USD', 18_900, 'expenses:entertainment', 'Broadway, two seats', {
      tags,
      fee: 'line',
    }),
  )
  daily(plan, base, 38, 41, [3, 6], ({ book, date, rng }) => {
    const [name, category, min, max] = rng.pick([
      ["Joe's Pizza", 'expenses:travel:food', 6, 24],
      ['Katz’s Delicatessen', 'expenses:travel:food', 28, 61],
      ['MTA OMNY', 'expenses:travel:transit', 2.9, 2.9],
      ['The Met', 'expenses:travel:activities', 30, 30],
      ['Duane Reade', 'expenses:health:pharmacy', 4, 19],
    ] as const)
    wiseSpend(book, date, 'USD', rng.cents(min, max), category, name, { tags })
  })
}

/**
 * Lunar New Year with family in Taiwan. Wise doesn't hold NTD, so it's ATM cash and the CAD card;
 * the card's fee comes a day after each spend.
 */
function taiwan(plan: Plan, base: string) {
  const tags = [`#taiwan${yearAt(base, 92)}`]
  on(plan, base, 50, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:travel:flights', 168_420, 'EVA Air, YYZ to TPE', { tags }),
  )
  away(plan, base, 92, 106)
  on(plan, base, 92, ({ book, date }) =>
    atm(book, date, 'NTD', 1_000_000, { tags, note: 'At Taoyuan airport' }),
  )
  on(plan, base, 92, ({ book, date }) =>
    cashForeign(book, date, 'NTD', 50_000, 'expenses:travel:transit', 'EasyCard top-up', { tags }),
  )
  on(plan, base, 95, ({ book, date }) =>
    cardForeign(book, date, 'NTD', 185_000, 'expenses:travel:food', '鼎泰豐 Din Tai Fung', {
      tags,
      fee: 'later',
    }),
  )
  on(plan, base, 97, ({ book, date }) =>
    cardForeign(book, date, 'NTD', 149_000, 'expenses:travel:transit', 'THSR Taipei to Tainan', {
      tags,
      fee: 'later',
    }),
  )
  on(plan, base, 97, ({ book, date }) =>
    cardForeign(book, date, 'NTD', 420_000, 'expenses:travel:lodging', 'Tainan hotel, 2 nights', {
      tags,
      fee: 'later',
    }),
  )
  // New Year's Eve: red envelopes for the family, in cash.
  on(plan, base, 99, ({ book, date }) => {
    cashForeign(book, date, 'NTD', 600_000, 'expenses:gifts', '紅包 for Grandma', { tags })
    cashForeign(book, date, 'NTD', 360_000, 'expenses:gifts', '紅包 for the cousins', { tags })
  })
  on(plan, base, 103, ({ book, date }) =>
    cardForeign(book, date, 'NTD', 120_000, 'expenses:gifts', 'Wang Tea, oolong to bring home', {
      tags,
      fee: 'later',
    }),
  )
  daily(plan, base, 92, 106, [2, 5], ({ book, date, rng }) => {
    const [name, category, min, max] = rng.pick([
      ['全家便利商店 FamilyMart', 'expenses:travel:food', 45, 180],
      ['7-Eleven', 'expenses:travel:food', 35, 160],
      ['士林夜市 Shilin night market', 'expenses:travel:food', 60, 260],
      ['Taipei MRT', 'expenses:travel:transit', 20, 65],
      ['Bubble tea', 'expenses:travel:food', 55, 85],
    ] as const)
    cashForeign(book, date, 'NTD', rng.int(min, max) * 100, category, name, { tags })
  })
}

/** Air Canada through Tokyo to Shanghai: Wise yen for three days, then Alipay and cash in China. */
function china(plan: Plan, base: string) {
  const tags = [`#china${yearAt(base, 158)}`]
  const tokyo = [...tags, `#tokyo-stopover-${yearAt(base, 158)}`]
  on(plan, base, 110, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:travel:flights', 191_255, 'Air Canada, YYZ to HND to PVG', {
      tags,
    }),
  )
  on(plan, base, 150, ({ book, date }) => wiseConvert(book, date, 'JPY', 4_000_000, { tags }))
  away(plan, base, 158, 172)
  on(plan, base, 158, ({ book, date }) =>
    wiseSpend(book, date, 'JPY', 300_000, 'expenses:travel:transit', 'Suica top-up', {
      tags: tokyo,
    }),
  )
  on(plan, base, 158, ({ book, date }) =>
    cardForeign(
      book,
      date,
      'JPY',
      3_840_000,
      'expenses:travel:lodging',
      'Hotel Gracery, 2 nights',
      {
        tags: tokyo,
      },
    ),
  )
  on(plan, base, 159, ({ book, date }) =>
    wiseSpend(book, date, 'JPY', 680_000, 'expenses:travel:food', '寿司 Sushi Dai', {
      tags: tokyo,
    }),
  )
  daily(plan, base, 158, 160, [3, 6], ({ book, date, rng }) => {
    const [name, category, min, max] = rng.pick([
      ['Lawson', 'expenses:travel:food', 300, 1200],
      ['Ichiran Ramen', 'expenses:travel:food', 1180, 1580],
      ['Tokyo Metro', 'expenses:travel:transit', 180, 330],
      ['Don Quijote', 'expenses:shopping', 900, 4800],
    ] as const)
    wiseSpend(book, date, 'JPY', rng.int(min, max) * 100, category, name, { tags: tokyo })
  })
  on(plan, base, 161, ({ book, date }) =>
    atm(book, date, 'CNY', 100_000, { tags, note: 'At Pudong airport' }),
  )
  on(plan, base, 161, ({ book, date }) =>
    alipay(book, date, 228_000, 'expenses:travel:lodging', 'Alipay: Shanghai hotel, 3 nights', {
      tags,
      note: 'Over 200 CNY, so Alipay adds 3% in CNY',
    }),
  )
  on(plan, base, 165, ({ book, date }) =>
    alipay(book, date, 55_300, 'expenses:travel:transit', 'Alipay: G train to Beijing', { tags }),
  )
  on(plan, base, 167, ({ book, date }) =>
    alipay(book, date, 68_000, 'expenses:travel:activities', 'Alipay: Mutianyu Great Wall tour', {
      tags,
    }),
  )
  daily(plan, base, 161, 172, [3, 6], ({ book, date, rng }) => {
    const [name, category, min, max, cash] = rng.pick([
      ['Alipay: 小笼包', 'expenses:travel:food', 18, 45, false],
      ['Alipay: Luckin Coffee', 'expenses:travel:food', 12, 29, false],
      ['Alipay: Didi', 'expenses:travel:transit', 14, 68, false],
      ['Alipay: Metro', 'expenses:travel:transit', 3, 8, false],
      ['Alipay: Peking duck dinner', 'expenses:travel:food', 180, 420, false],
      ['Market stall', 'expenses:travel:food', 8, 40, true],
    ] as const)
    const cents = rng.int(min, max) * 100
    if (cash) cashForeign(book, date, 'CNY', cents, category, name, { tags })
    else alipay(book, date, cents, category, name, { tags })
  })
}

/** A conference in Berlin, paid in EUR and claimed back from work in CAD. */
function berlin(plan: Plan, base: string) {
  const tags = [`#berlin-conference-${yearAt(base, 218)}`]
  const claim = 'expenses:work:reimbursable'
  const flight = 124_031
  let eurBefore = 0
  on(plan, base, 190, ({ book, date }) => {
    eurBefore = book.balance(claim, 'EUR')
    spend(book, date, VISA, claim, flight, 'Lufthansa, YYZ to BER', { tags })
  })
  on(plan, base, 200, ({ book, date }) => wiseConvert(book, date, 'EUR', 60_000, { tags }))
  away(plan, base, 218, 222)
  on(plan, base, 218, ({ book, date }) =>
    wiseSpend(book, date, 'EUR', 66_800, claim, 'Motel One Berlin, 4 nights', { tags }),
  )
  on(plan, base, 221, ({ book, date }) =>
    wiseSpend(book, date, 'EUR', 3_800, 'expenses:shopping', 'Ampelmann shop', {
      tags,
      note: "Mine, not work's: left out of the claim",
    }),
  )
  daily(plan, base, 218, 222, [2, 4], ({ book, date, rng }) => {
    const [name, min, max] = rng.pick([
      ['BVG ticket', 3.8, 3.8],
      ['Mustafa’s Gemüse Kebap', 6, 14],
      ['Café Einstein', 9, 28],
      ['Conference dinner', 34, 58],
    ] as const)
    wiseSpend(book, date, 'EUR', rng.cents(min, max), claim, name, { tags })
  })
  on(plan, base, 236, ({ book, date }) => {
    // The claim pays back the flight and the EUR spent, at the day's rate, in CAD.
    const eur = book.balance(claim, 'EUR') - eurBefore
    const cents = flight + Math.round(eur * rateOn('EUR', date))
    book.add(
      date,
      'Northwind expense claim',
      [
        [CHEQUING, cents, 'CAD'],
        [claim, -cents, 'CAD'],
      ],
      {
        shape: 'reimbursement',
        tags,
        note: 'Paid back in CAD for EUR spent: the category is left holding EUR and owing CAD',
      },
    )
  })
}

/** Brakes and rotors, a tow and a rental: savings pays for it. */
function fixCar(plan: Plan, base: string) {
  const tags = ['#fix-car']
  on(plan, base, 125, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:car:repair', 16_500, 'Tow truck, Highway 401', { tags }),
  )
  on(plan, base, 126, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:transport:rental', 23_876, 'Enterprise, 4 days', { tags }),
  )
  on(plan, base, 129, ({ book, date }) =>
    transfer(book, date, SAVINGS, CHEQUING, 200_000, 'From savings for the car', { tags }),
  )
  on(plan, base, 130, ({ book, date }) => {
    const [parts, labour, hst] = [112_040, 64_000, 22_885]
    book.add(
      date,
      'Midtown Auto, brakes and rotors',
      [
        ['expenses:car:parts', parts, 'CAD'],
        ['expenses:car:labour', labour, 'CAD'],
        ['expenses:tax:hst', hst, 'CAD'],
        [CHEQUING, -(parts + labour + hst), 'CAD'],
      ],
      { shape: 'split', tags },
    )
  })
  on(plan, base, 145, ({ book, date }) =>
    book.add(
      date,
      'Midtown Auto, warranty credit',
      [
        [CHEQUING, 12_000, 'CAD'],
        ['expenses:car:parts', -12_000, 'CAD'],
      ],
      { shape: 'refund', tags },
    ),
  )
}

/**
 * Toronto to Ottawa, for the new job. The lease takes first and last month; chequing dips below
 * zero overnight, which savings covers the next day.
 */
function move(plan: Plan, base: string) {
  const tags = [`#ottawa-move-${yearAt(base, 262)}`]
  on(plan, base, 238, ({ book, date }) => {
    const spare = book.balance(CHEQUING, 'CAD') - 120_000
    if (spare > 0) transfer(book, date, CHEQUING, SAVINGS, spare, 'To savings')
  })
  on(plan, base, 240, ({ book, date }) =>
    book.add(
      date,
      'Glebe Lofts, first and last month',
      [
        ['expenses:housing:rent', 390_000, 'CAD'],
        [CHEQUING, -390_000, 'CAD'],
      ],
      { tags, note: 'Chequing goes below zero until the next day' },
    ),
  )
  on(plan, base, 241, ({ book, date }) => {
    const owed = -book.balance(CHEQUING, 'CAD')
    if (owed > 0) {
      transfer(
        book,
        date,
        SAVINGS,
        CHEQUING,
        Math.ceil((owed + 100_000) / 50_000) * 50_000,
        'Cover the overdraft',
        { tags },
      )
    }
  })
  on(plan, base, 252, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:moving', 8_640, 'Canadian Tire, boxes and tape', { tags }),
  )
  on(plan, base, 258, ({ book, date }) => {
    spend(book, date, VISA, 'expenses:moving', 148_000, 'Lift & Shift Movers', { tags })
    spend(book, date, CASH, 'expenses:moving', 10_000, 'Tip for the movers', { tags })
    spend(book, date, CHEQUING, 'expenses:housing:cleaning', 22_000, 'Move-out clean', { tags })
  })
  on(plan, base, 263, ({ book, date }) => {
    const [furniture, delivery, assembly] = [128_610, 9_900, 14_000]
    book.add(
      date,
      'IKEA Ottawa',
      [
        ['expenses:housing:furniture', furniture, 'CAD'],
        ['expenses:moving', delivery + assembly, 'CAD'],
        [VISA, -(furniture + delivery + assembly), 'CAD'],
      ],
      { shape: 'split', tags },
    )
  })
  on(plan, base, 265, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:housing:internet', 4_995, 'Start.ca install', { tags }),
  )
  on(plan, base, 280, ({ book, date }) =>
    book.add(
      date,
      'Harbourview key deposit back',
      [
        [CHEQUING, 5_000, 'CAD'],
        ['expenses:housing:rent', -5_000, 'CAD'],
      ],
      { shape: 'refund', tags },
    ),
  )
}

/**
 * A cousin's wedding in Prague next year, booked and paid for this year: CZK through Wise, and a
 * train to Vienna in EUR after Berlin used the EUR up.
 */
function prague(plan: Plan, base: string) {
  const tags = [`#prague-cousin-wedding-${Number(yearAt(base, 302)) + 1}`]
  on(plan, base, 302, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:travel:flights', 138_862, 'LOT, YOW to WAW to PRG', { tags }),
  )
  on(plan, base, 318, ({ book, date }) => wiseConvert(book, date, 'CZK', 1_200_000, { tags }))
  on(plan, base, 320, ({ book, date }) =>
    wiseSpend(
      book,
      date,
      'CZK',
      480_000,
      'expenses:travel:lodging',
      'Hotel deposit, Pension U Zlatého Klíče, Malá Strana: 2 nights, breakfast included, refundable until 30 days before arrival',
      { tags, note: 'The longest description in the ledger' },
    ),
  )
  on(plan, base, 333, ({ book, date }) =>
    wiseSpend(book, date, 'CZK', 500_000, 'expenses:gifts', 'Wedding gift for Tereza & Ondřej', {
      tags,
    }),
  )
  on(plan, base, 340, ({ book, date }) =>
    spend(book, date, VISA, 'expenses:shopping:clothing', 64_200, 'Harry Rosen, suit', { tags }),
  )
  on(plan, base, 351, ({ book, date }) =>
    wiseSpend(book, date, 'EUR', 3_990, 'expenses:travel:transit', 'ÖBB, Praha to Wien', { tags }),
  )
}

/** Wise's interest on the USD balance: a one-cent transaction, in a foreign currency. */
function oneCent(plan: Plan, base: string) {
  on(plan, base, 200, ({ book, date }) =>
    book.add(
      date,
      'Wise interest',
      [
        [wise('USD'), 1, 'USD'],
        ['income:interest', -1, 'USD'],
      ],
      { shape: 'interest', note: 'One cent, in USD' },
    ),
  )
}
