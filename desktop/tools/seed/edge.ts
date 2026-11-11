// A small ledger of only the odd cases, each easy to find: what the app has to draw without
// breaking. Every one is dated in the last three weeks, but one from long ago.

import { addDays } from '@have-fish/core/calendar-date'
import type { Book, Leg } from './book'
import {
  CASH,
  CHEQUING,
  FX,
  FX_FEES,
  OPENING_PATH,
  SAVINGS,
  UNSORTED_PATH,
  VISA,
  wise,
} from './moves'

const USD_CARD = 'liabilities:card:usd'
const EMPTIED = 'assets:bank:old-savings'
const CLOSED = 'assets:bank:closed'

export function edges(book: Book, today: string) {
  const ago = (n: number) => addDays(today, -n)
  const start = ago(21)
  for (const [path, kind, cur] of [
    [CHEQUING, 'bank', 'CAD'],
    [SAVINGS, 'bank', 'CAD'],
    [VISA, 'card', 'CAD'],
    [USD_CARD, 'card', 'USD'],
    [EMPTIED, 'bank', 'CAD'],
    [CLOSED, 'bank', 'CAD'],
    [wise('CAD'), 'bank', 'CAD'],
    [wise('USD'), 'bank', 'USD'],
    [wise('EUR'), 'bank', 'EUR'],
    [wise('CZK'), 'bank', 'CZK'],
    [wise('JPY'), 'bank', 'JPY'],
  ] as const) {
    book.open(path, kind, cur, start)
  }
  book.open(CASH, 'cash', null, start, true)
  const closed = book.accounts.get(CLOSED)
  if (closed) closed.deletedAt = Date.parse(`${ago(20)}T15:00:00Z`)

  const add = (n: number, description: string, legs: Leg[], note: string) =>
    book.add(ago(n), description, legs, { shape: 'edge', note })
  const opening = (path: string, c: number, cur: string, note: string) =>
    book.add(
      start,
      'Starting balance',
      [
        [path, c, cur],
        [OPENING_PATH, -c, cur],
      ],
      { shape: 'opening', note },
    )

  opening(CHEQUING, 250_000, 'CAD', 'Chequing starts at 2,500')
  opening(SAVINGS, 123_456_789, 'CAD', 'Over a million: the widest balance')
  opening(EMPTIED, 50_000, 'CAD', 'Moved out in full later: ends at zero')
  opening(wise('CAD'), 100_000, 'CAD', 'Wise CAD starts at 1,000')
  opening(wise('USD'), 20_000, 'USD', 'Wise USD starts at 200')
  opening(wise('EUR'), 5_000, 'EUR', 'Wise EUR starts at 50')
  opening(wise('CZK'), 50_000, 'CZK', 'Wise CZK starts at 500')
  opening(CASH, 2_000, 'CAD', 'The wallet holds CAD...')
  opening(CASH, 4_000, 'EUR', '...and EUR...')
  opening(CASH, 50_000, 'JPY', '...and JPY...')
  opening(CASH, 100_000, 'NTD', '...and NTD: four currencies in one account')

  const spend = (
    n: number,
    description: string,
    c: number,
    cur: string,
    from: string,
    to: string,
    note: string,
  ) =>
    add(
      n,
      description,
      [
        [to, c, cur],
        [from, -c, cur],
      ],
      note,
    )

  book.add(
    '2009-01-01',
    'From long ago',
    [
      ['expenses:shopping', 4_200, 'CAD'],
      [VISA, -4_200, 'CAD'],
    ],
    { shape: 'edge', note: 'Years before everything else: the list and the reports reach back' },
  )
  spend(19, 'One cent', 1, 'CAD', VISA, 'expenses:food:coffee', 'The smallest amount')
  spend(
    19,
    'Twelve thousand on the card',
    1_234_567,
    'CAD',
    VISA,
    'expenses:shopping',
    'A wide amount: 12,345.67',
  )
  spend(18, 'One yen', 100, 'JPY', CASH, 'expenses:food:coffee', 'The smallest whole-yen amount')
  spend(
    18,
    'NTD with cents',
    3_550,
    'NTD',
    CASH,
    'expenses:food:coffee',
    'NTD allows cents; most never have them',
  )
  add(
    18,
    'Twelve million yen',
    [
      [wise('JPY'), 1_234_567_800, 'JPY'],
      [FX, -1_234_567_800, 'JPY'],
      [FX, 11_234_567, 'CAD'],
      [SAVINGS, -11_234_567, 'CAD'],
    ],
    'A whole-number currency with eight digits',
  )
  spend(
    17,
    'A very long description that keeps going past where any column could show it: the hotel, the dates, the confirmation number ABC-123-XYZ, a note about breakfast, and then a little more so that it wraps at least twice in any pane',
    4_500,
    'CAD',
    VISA,
    'expenses:travel:lodging',
    '300 characters',
  )
  spend(
    17,
    '鼎泰豐 小籠包 十個',
    68_000,
    'NTD',
    CASH,
    'expenses:food:restaurants',
    'Chinese characters only',
  )
  spend(16, '🎂 Birthday cake 🎉', 3_899, 'CAD', VISA, 'expenses:food:groceries', 'Emoji')
  spend(
    16,
    'שוק הכרמל Carmel market',
    2_400,
    'EUR',
    CASH,
    'expenses:food:groceries',
    'Right-to-left text, then left-to-right',
  )
  spend(
    16,
    'Café with a combining accent',
    450,
    'CAD',
    VISA,
    'expenses:food:coffee',
    'É written as E plus an accent mark',
  )
  spend(15, '', 1_200, 'CAD', VISA, 'expenses:food:coffee', 'No description at all')
  add(
    15,
    'Seven-way split',
    [
      ['expenses:food:groceries', 4_210, 'CAD'],
      ['expenses:household', 1_899, 'CAD'],
      ['expenses:health:pharmacy', 1_245, 'CAD'],
      ['expenses:shopping:clothing', 2_999, 'CAD'],
      ['expenses:gifts', 1_500, 'CAD'],
      ['expenses:entertainment', 999, 'CAD'],
      [VISA, -12_852, 'CAD'],
    ],
    'One payer, six categories',
  )
  add(
    14,
    'Paid from three Wise balances',
    [
      ['expenses:travel:lodging', 200_000, 'CZK'],
      [wise('CZK'), -50_000, 'CZK'],
      [FX, -80_000, 'CZK'],
      [FX, 3_270, 'EUR'],
      [wise('EUR'), -3_270, 'EUR'],
      [FX, -70_000, 'CZK'],
      [FX, 4_284, 'CAD'],
      [FX_FEES, 51, 'CAD'],
      [wise('CAD'), -4_335, 'CAD'],
    ],
    'CZK spent: part CZK, part EUR converted, part CAD converted',
  )
  add(
    13,
    'Wise: USD to EUR',
    [
      [wise('USD'), -10_000, 'USD'],
      [FX_FEES, 55, 'USD'],
      [FX, 9_945, 'USD'],
      [FX, -9_100, 'EUR'],
      [wise('EUR'), 9_100, 'EUR'],
    ],
    'A conversion with no CAD in it, and its fee in USD',
  )
  spend(
    13,
    'Freelance invoice',
    75_000,
    'USD',
    'income:freelance',
    wise('USD'),
    'Income straight into a USD account',
  )
  spend(
    12,
    'Amazon.com on the USD card',
    4_200,
    'USD',
    USD_CARD,
    'expenses:shopping',
    'A card kept to USD',
  )
  spend(
    12,
    'Corner store',
    650,
    'CAD',
    CASH,
    UNSORTED_PATH,
    'No category: reports count it as unsorted',
  )
  spend(11, 'Bike shop', 2_000, 'CAD', VISA, 'expenses:hobbies', 'Spent 20...')
  spend(
    10,
    'Bike shop refund',
    3_500,
    'CAD',
    'expenses:hobbies',
    VISA,
    '...refunded 35: the category ends below zero',
  )
  for (const n of [9, 7, 5]) {
    spend(
      n,
      'Same spend, three days',
      1_500,
      'CAD',
      VISA,
      'expenses:food:takeout',
      'Same words and amount on different days',
    )
  }
  for (let i = 0; i < 2; i++) {
    spend(
      8,
      'Same spend twice in a day',
      2_250,
      'CAD',
      VISA,
      'expenses:food:takeout',
      'Both kept: they really happened',
    )
  }
  for (let i = 1; i <= 25; i++) {
    spend(
      6,
      `Busy day, spend ${i}`,
      100 * i,
      'CAD',
      CHEQUING,
      'expenses:food:coffee',
      '25 on one day',
    )
  }
  spend(
    4,
    'Emptied the old account',
    50_000,
    'CAD',
    EMPTIED,
    CHEQUING,
    'Leaves old-savings at zero',
  )
  add(
    3,
    'Two lines from one card',
    [
      ['expenses:food:groceries', 1_500, 'CAD'],
      [VISA, -1_000, 'CAD'],
      [VISA, -500, 'CAD'],
    ],
    'The same account twice in one transaction',
  )
  add(
    3,
    'A line of zero',
    [
      ['expenses:food:groceries', 1_000, 'CAD'],
      [FX_FEES, 0, 'CAD'],
      [CASH, -1_000, 'CAD'],
    ],
    'One posting moves nothing',
  )
  const fixed = spend(
    2,
    'Typed the wrong amount',
    4_580,
    'CAD',
    VISA,
    'expenses:food:groceries',
    'Saved as 54.80, fixed to 45.80',
  )
  book.mistype(
    fixed,
    'amount',
    {
      ...fixed.doc,
      postings: fixed.doc.postings.map((p) => ({
        ...p,
        amount: p.amount.startsWith('-') ? '-54.80' : '54.80',
      })),
    },
    Math.min(fixed.doc.origin.createdAt + 3_600_000, book.options.nowMs),
  )
  const gone = spend(
    1,
    'Saved and then deleted',
    999,
    'CAD',
    VISA,
    'expenses:food:coffee',
    'The original stays; its copy is deleted',
  )
  book.deletedCopy(gone, Math.min(gone.doc.origin.createdAt + 120_000, book.options.nowMs))
  spend(0, 'Today', 500, 'CAD', VISA, 'expenses:food:coffee', 'Dated today')
}
