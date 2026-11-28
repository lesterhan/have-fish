import type { Mark } from '@have-fish/core/rate-for'
import type { Spent } from '@have-fish/core/spending'
import { describe, expect, test } from 'vitest'
import { copy } from '../../../copy'
import type {
  Bridge,
  CommandName,
  ListedTransaction,
  Missed,
  ReportedSpend,
  Values,
  Wire,
} from '../../../shared/commands'
import { type Ask, query } from '../../ledger/query'
import {
  changeMarkOf,
  changeOf,
  daysToAsk,
  figureOf,
  fixingFor,
  guessed,
  guessesBehind,
  guessKey,
  guessLabel,
  idsWanted,
  leftAfterOffer,
  lineDays,
  lineLabel,
  lookOf,
  missedOn,
  missedWords,
  nearestOf,
  offerOf,
  spendsBehind,
  spentOf,
  sumText,
  thisWeek,
  treeColumnsOf,
  treeKey,
  treeRows,
  weekAfter,
  weekSpending,
} from './report'

describe('the week shown', () => {
  test('this week is Monday to Sunday', () => {
    expect(thisWeek('2026-11-04')).toEqual({ start: '2026-11-02', end: '2026-11-08' })
  })

  test('◀ and ▶ go a week at a time, across months and years', () => {
    const week = thisWeek('2026-12-30')
    expect(weekAfter(week, -1)).toEqual({ start: '2026-12-21', end: '2026-12-27' })
    expect(weekAfter(week, 1)).toEqual({ start: '2027-01-04', end: '2027-01-10' })
  })
})

describe('spentOf', () => {
  test('the report’s amounts in cents', () => {
    const report: Values['report.spending'] = {
      currency: 'CAD',
      spent: [{ id: 'a', category: 'food', amount: '4.50', mark: 'cost' }],
    }
    expect(spentOf(report)).toEqual([{ id: 'a', category: 'food', cents: 450, mark: 'cost' }])
  })

  test('a missing spend keeps its own money, in cents; a counted one has none', () => {
    const report: Values['report.spending'] = {
      currency: 'CAD',
      spent: [
        { id: 'a', category: 'food', amount: '4.50', mark: 'cost' },
        {
          id: 'b',
          category: '',
          amount: '0.00',
          mark: 'missing',
          uncounted: { amount: '1500.00', currency: 'JPY' },
        },
      ],
    }
    const [counted, missing] = spentOf(report)
    expect(counted).toEqual({ id: 'a', category: 'food', cents: 450, mark: 'cost' })
    expect(counted).not.toHaveProperty('uncounted')
    expect(missing).toEqual({
      id: 'b',
      category: '',
      cents: 0,
      mark: 'missing',
      uncounted: { currency: 'JPY', cents: 150000 },
    })
  })
})

describe('figureOf', () => {
  test('all counted: the figure alone', () => {
    expect(figureOf(4985, [], 'CAD')).toEqual({
      counted: { amount: '49.85', currency: 'CAD' },
      uncounted: [],
    })
  })

  test('part counted: the figure, then each currency it couldn’t, after a plus', () => {
    expect(figureOf(3620, [{ currency: 'JPY', cents: 150000 }], 'CAD')).toEqual({
      counted: { amount: '36.20', currency: 'CAD' },
      uncounted: [{ money: { amount: '1500.00', currency: 'JPY' }, sign: 'plus' }],
    })
  })

  test('part counted and two currencies: a plus before each', () => {
    expect(
      figureOf(
        3620,
        [
          { currency: 'EUR', cents: 1000 },
          { currency: 'JPY', cents: 150000 },
        ],
        'CAD',
      ),
    ).toEqual({
      counted: { amount: '36.20', currency: 'CAD' },
      uncounted: [
        { money: { amount: '10.00', currency: 'EUR' }, sign: 'plus' },
        { money: { amount: '1500.00', currency: 'JPY' }, sign: 'plus' },
      ],
    })
  })

  test('nothing counted: no 0.00, and no plus before the first', () => {
    expect(figureOf(0, [{ currency: 'JPY', cents: 150000 }], 'CAD')).toEqual({
      counted: null,
      uncounted: [{ money: { amount: '1500.00', currency: 'JPY' }, sign: null }],
    })
  })

  test('nothing counted and two currencies: a plus before the second', () => {
    expect(
      figureOf(
        0,
        [
          { currency: 'EUR', cents: 1000 },
          { currency: 'JPY', cents: 150000 },
        ],
        'CAD',
      ),
    ).toEqual({
      counted: null,
      uncounted: [
        { money: { amount: '10.00', currency: 'EUR' }, sign: null },
        { money: { amount: '1500.00', currency: 'JPY' }, sign: 'plus' },
      ],
    })
  })

  test('a sum of zero with nothing uncounted still reads 0.00', () => {
    expect(figureOf(0, [], 'CAD')).toEqual({
      counted: { amount: '0.00', currency: 'CAD' },
      uncounted: [],
    })
  })

  test('a refund it couldn’t count: a minus in the plus’s place, and the amount without its sign', () => {
    expect(figureOf(3620, [{ currency: 'JPY', cents: -150000 }], 'CAD')).toEqual({
      counted: { amount: '36.20', currency: 'CAD' },
      uncounted: [{ money: { amount: '1500.00', currency: 'JPY' }, sign: 'minus' }],
    })
  })

  test('only a refund it couldn’t count: the amount alone, with its own minus', () => {
    expect(figureOf(0, [{ currency: 'JPY', cents: -150000 }], 'CAD')).toEqual({
      counted: null,
      uncounted: [{ money: { amount: '-1500.00', currency: 'JPY' }, sign: null }],
    })
  })
})

describe('sumText', () => {
  test('the header says what it counted, then what it couldn’t', () => {
    expect(sumText(3620, [{ currency: 'JPY', cents: 150000 }], 'CAD')).toBe('36.20 + 1,500 JPY')
  })

  test('nothing counted: the first currency alone, the next after a plus', () => {
    expect(
      sumText(
        0,
        [
          { currency: 'EUR', cents: 1000 },
          { currency: 'JPY', cents: 150000 },
        ],
        'CAD',
      ),
    ).toBe('10.00 EUR + 1,500 JPY')
  })

  test('all counted: the sum as the header has always said it', () => {
    expect(sumText(123450, [], 'CAD')).toBe('1234.50')
  })

  test('a refund it couldn’t count reads after a minus', () => {
    expect(sumText(3620, [{ currency: 'JPY', cents: -150000 }], 'CAD')).toBe('36.20 − 1,500 JPY')
  })
})

describe('lineLabel', () => {
  test('a category by its last name; unsorted, and a level’s own, in words', () => {
    expect(lineLabel({ holds: 'category', label: 'coffee' })).toBe('coffee')
    expect(lineLabel({ holds: 'unsorted', label: '' })).toBe('Unsorted')
    expect(lineLabel({ holds: 'own', label: 'food' })).toBe('Just food')
  })
})

describe('guessed', () => {
  test('borrowed and missing are guesses, and exact, cost, mine and estimate are not', () => {
    expect(guessed('borrowed')).toBe(true)
    expect(guessed('missing')).toBe(true)
    expect(guessed('exact')).toBe(false)
    expect(guessed('cost')).toBe(false)
    expect(guessed('mine')).toBe(false)
    expect(guessed('estimate')).toBe(false)
    expect(guessed(null)).toBe(false)
  })
})

describe('lookOf', () => {
  test('a guess if borrowed or missing, fetched if an estimate, plain for the rest', () => {
    expect(lookOf('exact')).toBe('plain')
    expect(lookOf('cost')).toBe('plain')
    expect(lookOf('mine')).toBe('plain')
    expect(lookOf('estimate')).toBe('fetched')
    expect(lookOf('borrowed')).toBe('guessed')
    expect(lookOf('missing')).toBe('guessed')
    expect(lookOf(null)).toBe('plain')
  })
})

let n = 0
const spent = (category: string, cents: number, mark: Mark = 'exact'): Spent => ({
  id: `s${++n}`,
  category,
  cents,
  mark,
})

/** A reported spend whose rate was guessed on `date` in `currency`: borrowed, or missing. */
const reported = (
  category: string,
  date: string,
  currency: string,
  from: { date: string; rate: string } | null = null,
): ReportedSpend => ({
  id: `r${++n}`,
  category,
  amount: '0.00',
  mark: from === null ? 'missing' : 'borrowed',
  guess: { date, currency, from },
})

describe('guessesBehind', () => {
  const FOOD = { holds: 'category', category: 'food' } as const
  const UNSORTED = { holds: 'unsorted', category: '' } as const
  const GBP = { date: '2026-11-02', rate: '1.71' }

  test('a guessed spend behind the row, and one outside it left out', () => {
    const spends = [
      reported('food:coffee', '2026-11-05', 'GBP', GBP),
      reported('fun', '2026-11-06', 'JPY'),
    ]

    expect(guessesBehind(spends, FOOD)).toEqual([
      { date: '2026-11-05', currency: 'GBP', from: GBP },
    ])
  })

  test('every guessed day with none picked', () => {
    const spends = [
      reported('food:coffee', '2026-11-05', 'GBP', GBP),
      reported('fun', '2026-11-06', 'JPY'),
    ]

    expect(guessesBehind(spends, null)).toEqual([
      { date: '2026-11-05', currency: 'GBP', from: GBP },
      { date: '2026-11-06', currency: 'JPY', from: null },
    ])
  })

  test('unsorted is the empty category', () => {
    const spends = [reported('', '2026-11-05', 'JPY'), reported('food', '2026-11-05', 'GBP', GBP)]

    expect(guessesBehind(spends, UNSORTED)).toEqual([
      { date: '2026-11-05', currency: 'JPY', from: null },
    ])
  })

  test('the same day and currency twice is one line', () => {
    const spends = [
      reported('food:coffee', '2026-11-05', 'GBP', GBP),
      reported('food', '2026-11-05', 'GBP', GBP),
    ]

    expect(guessesBehind(spends, FOOD)).toEqual([
      { date: '2026-11-05', currency: 'GBP', from: GBP },
    ])
  })

  test('the earlier day first', () => {
    const spends = [
      reported('food', '2026-11-06', 'JPY'),
      reported('food', '2026-11-05', 'GBP', GBP),
    ]

    expect(guessesBehind(spends, null).map(guessKey)).toEqual(['2026-11-05-GBP', '2026-11-06-JPY'])
  })

  test('the same day, by currency', () => {
    const spends = [
      reported('food', '2026-11-05', 'JPY'),
      reported('food', '2026-11-05', 'GBP', GBP),
    ]

    expect(guessesBehind(spends, null).map(guessKey)).toEqual(['2026-11-05-GBP', '2026-11-05-JPY'])
  })

  test('a spend the week trusted has no line', () => {
    const trusted: ReportedSpend = { id: 'r-mine', category: 'food', amount: '7.22', mark: 'mine' }

    expect(guessesBehind([trusted], null)).toEqual([])
  })

  test('a currency with no rate is one line, at its first day', () => {
    const spends = [reported('food', '2026-11-05', 'JPY'), reported('fun', '2026-11-07', 'JPY')]

    expect(guessesBehind(spends, null)).toEqual([
      { date: '2026-11-05', currency: 'JPY', from: null },
    ])
  })

  test('the missing line takes the first day, whatever the order given', () => {
    const spends = [reported('fun', '2026-11-07', 'JPY'), reported('food', '2026-11-05', 'JPY')]

    expect(guessesBehind(spends, null)).toEqual([
      { date: '2026-11-05', currency: 'JPY', from: null },
    ])
  })

  test('each missing currency is its own line', () => {
    const spends = [reported('food', '2026-11-05', 'JPY'), reported('fun', '2026-11-05', 'EUR')]

    expect(guessesBehind(spends, null)).toEqual([
      { date: '2026-11-05', currency: 'EUR', from: null },
      { date: '2026-11-05', currency: 'JPY', from: null },
    ])
  })

  test('a borrowed currency keeps a line a day', () => {
    const spends = [
      reported('food', '2026-11-05', 'GBP', GBP),
      reported('fun', '2026-11-06', 'GBP', GBP),
    ]

    expect(guessesBehind(spends, null)).toEqual([
      { date: '2026-11-05', currency: 'GBP', from: GBP },
      { date: '2026-11-06', currency: 'GBP', from: GBP },
    ])
  })

  test('the missing line sits at its first day among the others', () => {
    const spends = [
      reported('food', '2026-11-06', 'GBP', GBP),
      reported('food', '2026-11-05', 'JPY'),
      reported('fun', '2026-11-07', 'JPY'),
    ]

    expect(guessesBehind(spends, null).map(guessKey)).toEqual(['2026-11-05-JPY', '2026-11-06-GBP'])
  })
})

describe('fixingFor', () => {
  const ROWS = [
    { key: 'category:food', holds: 'category', category: 'food' },
    { key: 'category:fun', holds: 'category', category: 'fun' },
  ] as const
  const GBP = { date: '2026-11-02', rate: '1.71' }
  const shown = [
    reported('food:coffee', '2026-11-05', 'GBP', GBP),
    reported('fun', '2026-11-06', 'JPY'),
  ]

  test('a row’s figure lists only its row’s days', () => {
    expect(fixingFor({ key: 'category:food', week: 'shown' }, shown, [], ROWS).lines).toEqual([
      { date: '2026-11-05', currency: 'GBP', from: GBP },
    ])
  })

  test('the total’s figure lists every row’s days', () => {
    expect(fixingFor({ key: null, week: 'shown' }, shown, [], ROWS).lines).toEqual([
      { date: '2026-11-05', currency: 'GBP', from: GBP },
      { date: '2026-11-06', currency: 'JPY', from: null },
    ])
  })

  test('a week’s figure takes only that week', () => {
    const thisWeek = [reported('fun', '2026-11-06', 'JPY')]
    const lastWeek = [reported('food:coffee', '2026-10-29', 'GBP', GBP)]

    expect(fixingFor({ key: null, week: 'before' }, thisWeek, lastWeek, ROWS).lines).toEqual([
      { date: '2026-10-29', currency: 'GBP', from: GBP },
    ])
  })

  test('the change takes both weeks, the earlier first', () => {
    const thisWeek = [reported('fun', '2026-11-06', 'JPY')]
    const lastWeek = [reported('food:coffee', '2026-10-29', 'GBP', GBP)]

    expect(fixingFor({ key: null, week: 'both' }, thisWeek, lastWeek, ROWS).lines).toEqual([
      { date: '2026-10-29', currency: 'GBP', from: GBP },
      { date: '2026-11-06', currency: 'JPY', from: null },
    ])
  })

  test('the days are only the row’s, not another row’s', () => {
    expect(fixingFor({ key: 'category:food', week: 'shown' }, shown, [], ROWS).days).toEqual([
      { date: '2026-11-05', currency: 'GBP' },
    ])
  })

  test('a missing currency is every day it was missing on, where the lines show one', () => {
    const spent = [reported('fun', '2026-11-05', 'JPY'), reported('fun', '2026-11-07', 'JPY')]

    const fixing = fixingFor({ key: null, week: 'shown' }, spent, [], ROWS)

    expect(fixing.days).toEqual([
      { date: '2026-11-05', currency: 'JPY' },
      { date: '2026-11-07', currency: 'JPY' },
    ])
    expect(fixing.lines).toEqual([{ date: '2026-11-05', currency: 'JPY', from: null }])
  })

  test('a borrowed day and currency twice is asked once', () => {
    const spent = [
      reported('food:coffee', '2026-11-05', 'GBP', GBP),
      reported('food', '2026-11-05', 'GBP', GBP),
    ]

    expect(fixingFor({ key: null, week: 'shown' }, spent, [], ROWS).days).toEqual([
      { date: '2026-11-05', currency: 'GBP' },
    ])
  })

  test('the days go by day, then by currency within the day', () => {
    const spent = [
      reported('fun', '2026-11-06', 'GBP', GBP),
      reported('fun', '2026-11-05', 'JPY'),
      reported('fun', '2026-11-05', 'EUR'),
    ]

    expect(fixingFor({ key: null, week: 'shown' }, spent, [], ROWS).days).toEqual([
      { date: '2026-11-05', currency: 'EUR' },
      { date: '2026-11-05', currency: 'JPY' },
      { date: '2026-11-06', currency: 'GBP' },
    ])
  })

  test('the change’s days take both weeks, the earlier first', () => {
    const thisWeek = [reported('fun', '2026-11-06', 'JPY')]
    const lastWeek = [reported('food:coffee', '2026-10-29', 'GBP', GBP)]

    expect(fixingFor({ key: null, week: 'both' }, thisWeek, lastWeek, ROWS).days).toEqual([
      { date: '2026-10-29', currency: 'GBP' },
      { date: '2026-11-06', currency: 'JPY' },
    ])
  })

  test('a week that trusted every rate asks for no day', () => {
    const trusted: ReportedSpend[] = [
      { id: 'r-mine', category: 'food', amount: '7.22', mark: 'mine' },
      { id: 'r-exact', category: 'fun', amount: '4.00', mark: 'exact' },
    ]

    expect(fixingFor({ key: null, week: 'shown' }, trusted, [], ROWS).days).toEqual([])
  })
})

describe('guessKey', () => {
  test('a day and currency named', () => {
    expect(guessKey({ date: '2026-11-05', currency: 'GBP' })).toBe('2026-11-05-GBP')
  })
})

describe('guessLabel', () => {
  test('a borrowed day says where its rate came from', () => {
    const guess = {
      date: '2026-11-05',
      currency: 'GBP',
      from: { date: '2026-11-02', rate: '1.71' },
    }

    expect(guessLabel(guess, '2026-11-25')).toBe('Thu 5 Nov · GBP · using 1.71 from Mon 2 Nov')
  })

  test('a currency with no rate says so, with no day', () => {
    const guess = { date: '2026-11-05', currency: 'JPY', from: null }

    expect(guessLabel(guess, '2026-11-25')).toBe('JPY · no rate on any day')
  })

  test('a day of another year says its year', () => {
    const guess = {
      date: '2025-12-29',
      currency: 'JPY',
      from: { date: '2025-12-26', rate: '0.0091' },
    }

    expect(guessLabel(guess, '2026-01-02')).toBe(
      'Mon 29 Dec 2025 · JPY · using 0.0091 from Fri 26 Dec 2025',
    )
  })
})

describe('nearestOf', () => {
  test('a borrowed line gives its own day, currency and the rate the label showed', () => {
    const line = {
      date: '2026-11-26',
      currency: 'JPY',
      from: { date: '2026-11-19', rate: '0.009123' },
    }

    expect(nearestOf([line])).toEqual([{ date: '2026-11-26', currency: 'JPY', rate: '0.009123' }])
  })

  test('a line with no rate is left out', () => {
    const borrowed = {
      date: '2026-11-26',
      currency: 'JPY',
      from: { date: '2026-11-19', rate: '0.009123' },
    }

    expect(nearestOf([borrowed, { date: '2026-11-26', currency: 'EUR', from: null }])).toEqual([
      { date: '2026-11-26', currency: 'JPY', rate: '0.009123' },
    ])
  })

  test('the lines keep the order they came in', () => {
    const jpy = {
      date: '2026-11-26',
      currency: 'JPY',
      from: { date: '2026-11-19', rate: '0.009123' },
    }
    const eur = { date: '2026-11-24', currency: 'EUR', from: { date: '2026-11-20', rate: '0.83' } }

    expect(nearestOf([jpy, eur])).toEqual([
      { date: '2026-11-26', currency: 'JPY', rate: '0.009123' },
      { date: '2026-11-24', currency: 'EUR', rate: '0.83' },
    ])
  })

  test('none borrowed is no rates', () => {
    expect(
      nearestOf([
        { date: '2026-11-26', currency: 'EUR', from: null },
        { date: '2026-11-26', currency: 'JPY', from: null },
      ]),
    ).toEqual([])
  })
})

/** One day a fetch wrote nothing for, with its offer when the service had an older rate. */
const missed = (
  currency: string,
  date: string,
  why: Missed['why'] = 'none',
  offer: Missed['offer'] = null,
): Missed => ({ date, currency, why, offer })

const OFFER = { date: '2022-02-28', rate: '0.0091' }

const askedDays = [
  { date: '2026-11-03', currency: 'JPY' },
  { date: '2026-11-04', currency: 'GBP' },
  { date: '2026-11-05', currency: 'JPY' },
]

describe('lineDays', () => {
  test('a missing currency stands for every day of it', () => {
    expect(lineDays({ date: '2026-11-05', currency: 'JPY', from: null }, askedDays)).toEqual([
      { date: '2026-11-03', currency: 'JPY' },
      { date: '2026-11-05', currency: 'JPY' },
    ])
  })

  test('a borrowed line stands for its own day', () => {
    const borrowed = { date: '2026-11-05', currency: 'JPY', from: { ...OFFER } }

    expect(lineDays(borrowed, askedDays)).toEqual([{ date: '2026-11-05', currency: 'JPY' }])
  })
})

describe('missedWords', () => {
  const TODAY = '2026-11-27'

  test.each(['RATES_NOT_FETCHED', 'RATES_UNREADABLE'] as const)(
    'a day the service couldn’t answer says its code, %s',
    (why) => {
      expect(missedWords([missed('JPY', '2026-11-05', why)], TODAY)).toBe(copy.errors.codes[why])
    },
  )

  test('a day with no rate at all says so, once', () => {
    expect(missedWords([missed('JPY', '2026-11-05')], TODAY)).toBe(
      'The service has no JPY rate for this day. Type it.',
    )
  })

  test('several days with no rate at all name each of them', () => {
    expect(missedWords([missed('JPY', '2026-11-03'), missed('JPY', '2026-11-05')], TODAY)).toBe(
      'The service has no JPY rate for Tue 3 Nov or Thu 5 Nov. Type them.',
    )
  })

  test('an older rate is named with its day and figure', () => {
    expect(missedWords([missed('JPY', '2026-11-05', 'none', { ...OFFER })], TODAY)).toBe(
      'The service has no JPY rate within a week of Thu 5 Nov. Its last, from Mon 28 Feb 2022, is 0.0091.',
    )
  })

  test('three days with an older rate name all three', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-05'].map((date) =>
      missed('JPY', date, 'none', { ...OFFER }),
    )

    expect(missedWords(days, TODAY)).toBe(
      'The service has no JPY rate within a week of Mon 2 Nov, Tue 3 Nov or Thu 5 Nov. Its last, from Mon 28 Feb 2022, is 0.0091.',
    )
  })

  test('a code on any day wins over an offer on another', () => {
    const days = [
      missed('JPY', '2026-11-03', 'RATES_NOT_FETCHED'),
      missed('JPY', '2026-11-05', 'none', { ...OFFER }),
    ]

    expect(missedWords(days, TODAY)).toBe(copy.errors.codes.RATES_NOT_FETCHED)
  })

  test('an offer on one day wins over none on another, naming the day it has', () => {
    const days = [missed('JPY', '2026-11-03'), missed('JPY', '2026-11-05', 'none', { ...OFFER })]

    expect(missedWords(days, TODAY)).toBe(
      'The service has no JPY rate within a week of Thu 5 Nov. Its last, from Mon 28 Feb 2022, is 0.0091.',
    )
  })
})

describe('offerOf', () => {
  test('the missed days with an older rate, and no other', () => {
    const days = [missed('JPY', '2026-11-03', 'none', { ...OFFER }), missed('JPY', '2026-11-05')]

    expect(offerOf(days)).toEqual([{ date: '2026-11-03', currency: 'JPY' }])
  })

  test('two days with the same offer are both offered', () => {
    const days = [
      missed('JPY', '2026-11-03', 'none', { ...OFFER }),
      missed('JPY', '2026-11-05', 'none', { ...OFFER }),
    ]

    expect(offerOf(days)).toEqual([
      { date: '2026-11-03', currency: 'JPY' },
      { date: '2026-11-05', currency: 'JPY' },
    ])
  })
})

describe('missedOn', () => {
  const JPY_MISSED = missed('JPY', '2026-11-05')
  const EUR_MISSED = missed('EUR', '2026-11-05')

  test('a line takes only its own currency’s days', () => {
    const line = { date: '2026-11-05', currency: 'JPY', from: null }

    expect(missedOn(line, [JPY_MISSED, EUR_MISSED], askedDays)).toEqual([JPY_MISSED])
  })

  test('a borrowed line takes its own day, with nothing missed elsewhere', () => {
    const line = { date: '2026-11-05', currency: 'JPY', from: { ...OFFER } }

    expect(missedOn(line, [EUR_MISSED], askedDays)).toEqual([])
  })

  test('before a fetch it takes nothing', () => {
    const line = { date: '2026-11-05', currency: 'JPY', from: null }

    expect(missedOn(line, null, askedDays)).toEqual([])
  })
})

describe('daysToAsk', () => {
  test('before a fetch, every day behind the figure', () => {
    expect(daysToAsk(null, askedDays)).toEqual(askedDays)
  })

  test('after one, only the days it missed', () => {
    const left = [missed('JPY', '2026-11-05'), missed('GBP', '2026-11-04')]

    expect(daysToAsk(left, askedDays)).toEqual([
      { date: '2026-11-05', currency: 'JPY' },
      { date: '2026-11-04', currency: 'GBP' },
    ])
  })
})

describe('leftAfterOffer', () => {
  const JPY_MISSED = missed('JPY', '2026-11-05', 'none', { ...OFFER })
  const EUR_MISSED = missed('EUR', '2026-11-05', 'RATES_NOT_FETCHED')

  test('takes the days it wrote out, and keeps the rest', () => {
    expect(
      leftAfterOffer([JPY_MISSED, EUR_MISSED], [{ date: '2026-11-05', currency: 'JPY' }], []),
    ).toEqual([EUR_MISSED])
  })

  test('adds what its answer missed, after what it had', () => {
    const again = missed('JPY', '2026-11-06', 'RATES_UNREADABLE')

    expect(
      leftAfterOffer([JPY_MISSED], [{ date: '2026-11-05', currency: 'JPY' }], [again]),
    ).toEqual([again])
  })
})

/** A row as `level key open`, with `open` when it has rows under it. */
const row = (r: ReturnType<typeof treeRows>[number]) =>
  `${r.level} ${r.key} ${r.open === undefined ? '–' : r.open ? 'open' : 'closed'} ${r.posinset}/${r.setsize}`

describe('treeRows', () => {
  test('nothing opened: the top rows only, each closed where it has rows under it', () => {
    const shown = [spent('food:coffee', 450), spent('fun', 2000)]
    const before = [spent('food:groceries', 500)]
    expect(treeRows(shown, before, new Set()).map(row)).toEqual([
      '1 category:fun – 1/2',
      '1 category:food closed 2/2',
    ])
  })

  test('a category opened: its children straight under it, the sibling after them', () => {
    const shown = [spent('food:groceries', 5000), spent('food:coffee', 450), spent('fun', 2000)]
    const rows = treeRows(shown, [], new Set(['food']))
    expect(rows.map(row)).toEqual([
      '1 category:food open 1/2',
      '2 category:food:groceries – 1/2',
      '2 category:food:coffee – 2/2',
      '1 category:fun – 2/2',
    ])
    expect(rows[1]?.parent).toBe('category:food')
  })

  test('a category opened inside another is a level deeper again', () => {
    const shown = [spent('food:restaurants:dining', 1000)]
    const rows = treeRows(shown, [], new Set(['food', 'food:restaurants']))
    expect(rows.map(row)).toEqual([
      '1 category:food open 1/1',
      '2 category:food:restaurants open 1/1',
      '3 category:food:restaurants:dining – 1/1',
    ])
  })

  test('a category opened in a week where nothing is under it has nothing under it', () => {
    const rows = treeRows([spent('food', 500)], [], new Set(['food']))
    expect(rows.map(row)).toEqual(['1 category:food – 1/1'])
    expect(rows[0]?.open).toBeUndefined()
  })
})

describe('treeKey', () => {
  const shown = [spent('food:coffee', 450), spent('food:groceries', 500), spent('fun', 2000)]
  const closed = treeRows(shown, [], new Set())
  const open = treeRows(shown, [], new Set(['food']))

  test('→ on a closed row with categories under it opens it', () => {
    expect(treeKey(closed, 'category:food', 'ArrowRight')).toEqual({ toggle: 'food' })
  })

  test('→ on an open row goes to its first child', () => {
    expect(treeKey(open, 'category:food', 'ArrowRight')).toEqual({
      active: 'category:food:groceries',
    })
  })

  test('← on an open row closes it', () => {
    expect(treeKey(open, 'category:food', 'ArrowLeft')).toEqual({ toggle: 'food' })
  })

  test('← on a child goes to its parent', () => {
    expect(treeKey(open, 'category:food:coffee', 'ArrowLeft')).toEqual({
      active: 'category:food',
    })
  })

  test('← at the top has nowhere to go', () => {
    expect(treeKey(closed, 'category:fun', 'ArrowLeft')).toBeNull()
  })

  test('Enter opens or closes a row that has categories under it, and does nothing else', () => {
    expect(treeKey(closed, 'category:food', 'Enter')).toEqual({ toggle: 'food' })
    expect(treeKey(closed, 'category:fun', 'Enter')).toBeNull()
    expect(treeKey(open, 'category:food:coffee', 'Enter')).toBeNull()
  })

  test('↓ and the rest are the list’s', () => {
    expect(treeKey(open, 'category:food', 'ArrowDown')).toBeNull()
  })
})

describe('changeOf', () => {
  test('less than the week before', () => {
    expect(changeOf(6000, 8000)).toEqual({ cents: 2000, way: 'less' })
  })

  test('more than nothing', () => {
    expect(changeOf(18536, null)).toEqual({ cents: 18536, way: 'more' })
  })

  test('nothing this week is less than the week before', () => {
    expect(changeOf(null, 389)).toEqual({ cents: 389, way: 'less' })
  })

  test('the same either side says so, with nothing to add', () => {
    expect(changeOf(500, 500)).toEqual({ cents: 0, way: 'same' })
  })
})

describe('changeMarkOf', () => {
  test('the weaker of the two weeks', () => {
    expect(changeMarkOf('cost', 'missing')).toBe('missing')
    expect(changeMarkOf('estimate', 'exact')).toBe('estimate')
    expect(changeMarkOf('mine', 'estimate')).toBe('estimate')
    expect(changeMarkOf('borrowed', 'estimate')).toBe('borrowed')
  })

  test('a week with nothing takes the other week’s', () => {
    expect(changeMarkOf(null, 'estimate')).toBe('estimate')
    expect(changeMarkOf('borrowed', null)).toBe('borrowed')
    expect(changeMarkOf(null, null)).toBeNull()
  })
})

describe('treeColumnsOf', () => {
  test('a narrow tree keeps This week and Change, and drops Last week', () => {
    expect(treeColumnsOf(364)).toEqual({
      cells: ['name', 'shown', 'change'],
      template: 'minmax(0,1fr) 5em 7em',
    })
  })

  test('from 440px the four columns show', () => {
    expect(treeColumnsOf(440)).toEqual({
      cells: ['name', 'shown', 'before', 'change'],
      template: 'minmax(0,1fr) 5em 5em 7em',
    })
  })
})

describe('idsWanted', () => {
  test('each spend of the week once, whatever is selected', () => {
    const week = [spent('food:coffee', 450), spent('fun', 2000), spent('food', 100)]
    expect(idsWanted(week)).toEqual([week[0]?.id, week[1]?.id, week[2]?.id])
  })

  test('one spend split across food and fun is asked for once', () => {
    const split = [
      { id: 'split', category: 'food:coffee', cents: 450, mark: 'exact' as const },
      { id: 'split', category: 'fun', cents: 550, mark: 'exact' as const },
    ]
    expect(idsWanted(split)).toEqual(['split'])
  })
})

describe('spendsBehind', () => {
  const t = (id: string): ListedTransaction => ({
    id,
    date: '2026-11-04',
    description: id,
    shape: 'spend',
    amounts: [],
    simple: null,
    from: null,
    to: null,
    fromPath: null,
    toPath: null,
    legs: [],
    origin: { source: 'manual', at: 0, here: true, file: null, line: null },
  })
  const listed = [t('coffee'), t('rent'), t('lunch'), t('bus'), t('transfer')]
  const week: Spent[] = [
    { id: 'coffee', category: 'food:coffee', cents: 450, mark: 'exact' },
    { id: 'lunch', category: 'food', cents: 1200, mark: 'exact' },
    { id: 'bus', category: '', cents: 330, mark: 'exact' },
    { id: 'rent', category: 'home', cents: 100000, mark: 'exact' },
  ]
  const ids = (ts: ListedTransaction[]) => ts.map((x) => x.id)

  test('nothing picked: every spend of the week, in the list’s order', () => {
    expect(ids(spendsBehind(listed, week, undefined))).toEqual(['coffee', 'rent', 'lunch', 'bus'])
  })

  test('a row picked: what’s behind it', () => {
    const coffee = { holds: 'category', category: 'food:coffee' } as const
    expect(ids(spendsBehind(listed, week, coffee))).toEqual(['coffee'])
    const food = { holds: 'own', category: 'food' } as const
    expect(ids(spendsBehind(listed, week, food))).toEqual(['lunch'])
    const unsorted = { holds: 'unsorted', category: '' } as const
    expect(ids(spendsBehind(listed, week, unsorted))).toEqual(['bus'])
  })
})

describe('weekSpending', () => {
  type Report = Values['report.spending']
  const week = { start: '2026-11-02', end: '2026-11-08' }
  const refused = { ok: false, error: 'UNEXPECTED', detail: undefined } as const
  const reportOf = (ids: string[]): Report => ({
    currency: 'CAD',
    spent: ids.map((id) => ({ id, category: 'food', amount: '4.50', mark: 'exact' as const })),
  })
  const earlier = reportOf(['older'])
  const spends = [{ id: 'lunch' }, { id: 'snack' }] as ListedTransaction[]

  /**
   * A bridge that answers at once from fixed values and counts what it is asked: `report` for
   * the week, `earlier` for the week before, `spends` for the transactions.
   */
  function answering(answers: {
    report: Wire<Report>
    earlier?: Wire<Report>
    spends?: Wire<ListedTransaction[]>
  }) {
    const asked: { name: CommandName; input: unknown }[] = []
    const bridge = {
      async invoke(name: CommandName, input: unknown) {
        asked.push({ name, input })
        if (name === 'transaction.get') return answers.spends ?? { ok: true, value: spends }
        const { start } = input as { start: string }
        return start === week.start
          ? answers.report
          : (answers.earlier ?? { ok: true, value: earlier })
      },
      onChanged: () => () => {},
    } as unknown as Bridge
    const ask: Ask<'report.spending' | 'transaction.get'> = bridge.invoke
    return {
      bridge,
      ask,
      asked,
      count: (name: CommandName) => asked.filter((c) => c.name === name).length,
    }
  }

  test('asks the week and the week before, then the week’s spends once', async () => {
    const report = reportOf(['lunch', 'snack', 'lunch'])
    const { ask, asked } = answering({ report: { ok: true, value: report } })

    expect(await weekSpending(ask, week)).toEqual({ ok: true, value: { report, earlier, spends } })
    expect(asked).toEqual([
      { name: 'report.spending', input: { start: '2026-11-02', end: '2026-11-08' } },
      { name: 'report.spending', input: { start: '2026-10-26', end: '2026-11-01' } },
      { name: 'transaction.get', input: { ids: ['lunch', 'snack'] } },
    ])
  })

  test('a week with no spends never asks for them', async () => {
    const report = reportOf([])
    const { ask, count } = answering({ report: { ok: true, value: report } })

    expect(await weekSpending(ask, week)).toEqual({
      ok: true,
      value: { report, earlier, spends: [] },
    })
    expect(count('report.spending')).toBe(2)
    expect(count('transaction.get')).toBe(0)
  })

  test('the week’s report refused is the answer, and the spends aren’t asked', async () => {
    const { ask, count } = answering({ report: refused })

    expect(await weekSpending(ask, week)).toEqual(refused)
    expect(count('transaction.get')).toBe(0)
  })

  test('the spends refused is the answer', async () => {
    const { ask } = answering({ report: { ok: true, value: reportOf(['lunch']) }, spends: refused })

    expect(await weekSpending(ask, week)).toEqual(refused)
  })

  test('once answered, subscribing, showing and catching up ask nothing more', async () => {
    const { bridge, asked } = answering({ report: { ok: true, value: reportOf(['lunch']) } })
    const spending = query(bridge, ['report.spending', 'transaction.get'], weekSpending)
    spending.start()
    spending.show(true)
    spending.set(week)
    await spending.caughtUp()
    expect(asked).toHaveLength(3)

    spending.subscribe(() => {})
    spending.show(true)
    await spending.caughtUp()
    expect(asked).toHaveLength(3)
  })
})
