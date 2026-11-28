// The Reports place's rules: the week it shows, how each row reads, the tree it draws, and the
// spends beside it.

import { addDays, weekOf } from '@have-fish/core/calendar-date'
import { cents, format } from '@have-fish/core/money'
import { type Mark, weaker } from '@have-fish/core/rate-for'
import {
  type ComparedLine,
  comparedAt,
  isIn,
  type Spent,
  type Uncounted,
} from '@have-fish/core/spending'
import { copy } from '../../../copy'
import type {
  Guess,
  InputOf,
  ListedTransaction,
  Missed,
  Money,
  ReportedSpend,
  Values,
  Wire,
} from '../../../shared/commands'
import { day, money } from '../../format'
import type { Ask } from '../../ledger/query'
import type { TreeSpot } from '../../parts/listbox'

export type Week = { start: string; end: string }

/** The week `today` is in. */
export const thisWeek = (today: string): Week => weekOf(today)

/** The week `by` weeks after `week`; before it, when negative. */
export const weekAfter = (week: Week, by: number): Week => weekOf(addDays(week.start, by * 7))

/** What the report sums, in cents, with each spend's rate's mark and what it couldn't count. */
export const spentOf = (report: Values['report.spending']): Spent[] =>
  report.spent.map((s) => ({
    id: s.id,
    category: s.category,
    cents: cents(s.amount),
    mark: s.mark,
    ...(s.uncounted === undefined
      ? {}
      : { uncounted: { currency: s.uncounted.currency, cents: cents(s.uncounted.amount) } }),
  }))

/** How a line names itself. */
export function lineLabel(line: Pick<ComparedLine, 'holds' | 'label'>): string {
  if (line.holds === 'unsorted') return copy.reports.tree.unsorted
  if (line.holds === 'own') return copy.reports.tree.own(line.label)
  return line.label
}

/** A report's sum, for `Money`. */
export const moneyOf = (cents: number, currency: string): Money => ({
  amount: format(cents),
  currency,
})

/** How a week's figure reads: what it counted, then each currency it couldn't, by code. */
export type Figure = {
  counted: Money | null
  uncounted: { money: Money; sign: 'plus' | 'minus' | null }[]
}

/** A figure from its sum and what it couldn't count: no `0.00` when nothing was counted. */
export function figureOf(cents: number, uncounted: readonly Uncounted[], currency: string): Figure {
  const counted = cents === 0 && uncounted.length > 0 ? null : moneyOf(cents, currency)
  return {
    counted,
    uncounted: uncounted.map((one, i) => {
      // The first said alone keeps its own minus; any after a sign is said without one.
      const alone = counted === null && i === 0
      return {
        money: moneyOf(alone ? one.cents : Math.abs(one.cents), one.currency),
        sign: alone ? null : one.cents < 0 ? 'minus' : 'plus',
      }
    }),
  }
}

/** A week's sum as the header says it, on one line: `36.20 + 1,500 JPY`. */
export function sumText(cents: number, uncounted: readonly Uncounted[], currency: string): string {
  const { counted, uncounted: lines } = figureOf(cents, uncounted, currency)
  const parts = lines.map(({ money: one, sign }) => {
    const said = money(one.amount, one.currency)
    return sign === null ? said : [copy.reports.tree[sign], said].join(' ')
  })
  return [...(counted === null ? [] : [format(cents)]), ...parts].join(' ')
}

/** Whether an amount's rate was a guess: borrowed or missing. */
export const guessed = (mark: Mark | null): boolean => mark === 'borrowed' || mark === 'missing'

export type Look = 'guessed' | 'fetched' | 'plain'

/** How sure a figure looks: a guess if borrowed or missing, fetched if an estimate, else plain. */
export const lookOf = (mark: Mark | null): Look =>
  guessed(mark) ? 'guessed' : mark === 'estimate' ? 'fetched' : 'plain'

/** The change's mark: the weaker of its two weeks', or the one week's that has one. */
export const changeMarkOf = (mark: Mark | null, beforeMark: Mark | null): Mark | null =>
  mark === null ? beforeMark : beforeMark === null ? mark : weaker(mark, beforeMark)

/** A figure's place: its row by key (null for the total) and the week it sums. */
export type GuessedFigure = { key: string | null; week: 'shown' | 'before' | 'both' }

/** A guessed day's name among the popover's lines: its day and currency. */
export const guessKey = (guess: Pick<Guess, 'date' | 'currency'>): string =>
  `${guess.date}-${guess.currency}`

// A missing currency is one line, at its first day; a borrowed day and currency is one each.
const lineKey = (guess: Guess): string => (guess.from === null ? guess.currency : guessKey(guess))

/** The guessed spends' guesses behind `line` (every spend's for null), by day then currency. */
function guessesIn(
  spent: readonly ReportedSpend[],
  line: Pick<ComparedLine, 'holds' | 'category'> | null,
): Guess[] {
  const guesses: Guess[] = []
  for (const s of spent) {
    if (s.guess === undefined || (line !== null && !isIn(s, line))) continue
    guesses.push(s.guess)
  }
  guesses.sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency))
  return guesses
}

/**
 * The guessed lines behind `line` (every spend's for null), by day then currency: a borrowed
 * day and currency once each, and a currency with no rate once, at its first day.
 */
export function guessesBehind(
  spent: readonly ReportedSpend[],
  line: Pick<ComparedLine, 'holds' | 'category'> | null,
): Guess[] {
  const lines = new Map<string, Guess>()
  for (const guess of guessesIn(spent, line)) {
    const key = lineKey(guess)
    if (!lines.has(key)) lines.set(key, guess)
  }
  return [...lines.values()]
}

/** A guessed figure's popover: its lines, and every guessed day and currency behind them. */
export type Fixing = { lines: Guess[]; days: AskedDay[] }

/** One day and currency a fetch asks for. */
export type AskedDay = InputOf<'rate.fetch'>['days'][number]

/** The days a guessed line stands for: a missing currency's every day, a borrowed one its own. */
export function lineDays(line: Guess, days: readonly AskedDay[]): AskedDay[] {
  if (line.from !== null) return [{ date: line.date, currency: line.currency }]
  return days.filter((one) => one.currency === line.currency)
}

/** The missed days one line has, from what a fetch left: none before one has answered. */
export function missedOn(
  line: Guess,
  left: readonly Missed[] | null,
  days: readonly AskedDay[],
): Missed[] {
  const mine = lineDays(line, days).map(guessKey)
  return (left ?? []).filter((one) => mine.includes(guessKey(one)))
}

/** The days a try again asks: every guessed day at first, then only what missed. */
export function daysToAsk(left: readonly Missed[] | null, days: readonly AskedDay[]): AskedDay[] {
  return left === null ? [...days] : left.map((one) => ({ date: one.date, currency: one.currency }))
}

/** What Use it leaves: every missed day it didn't write, then what its answer missed. */
export function leftAfterOffer(
  left: readonly Missed[],
  offered: readonly AskedDay[],
  missed: readonly Missed[],
): Missed[] {
  const done = new Set(offered.map(guessKey))
  return [...left.filter((one) => !done.has(guessKey(one))), ...missed]
}

/** What a missed line says: its code, else its last rate before it, else that it has none. */
export function missedWords(missed: readonly Missed[], today: string): string {
  for (const one of missed) {
    if (one.why === 'RATES_NOT_FETCHED' || one.why === 'RATES_UNREADABLE') {
      return copy.errors.codes[one.why]
    }
  }
  const first = missed[0]
  if (first === undefined) return ''
  const days = missed.map((one) => day(one.date, today))
  const offers = missed.filter((one) => one.offer !== null)
  const offer = offers[0]?.offer
  if (offer === undefined || offer === null) return copy.reports.fetch.none(first.currency, days)
  const named = offers.map((one) => day(one.date, today))
  return copy.reports.fetch.older(first.currency, named, day(offer.date, today), offer.rate)
}

/** The missed days with an older rate, each once: what a line's Use it fetches. */
export const offerOf = (missed: readonly Missed[]): AskedDay[] =>
  missed.flatMap((one) => (one.offer === null ? [] : [{ date: one.date, currency: one.currency }]))

/** The lines behind a guessed figure, and every day and currency it guessed, each once. */
export function fixingFor(
  at: GuessedFigure,
  shown: readonly ReportedSpend[],
  before: readonly ReportedSpend[],
  rows: readonly Pick<TreeRow, 'key' | 'holds' | 'category'>[],
): Fixing {
  const row = at.key === null ? null : (rows.find((r) => r.key === at.key) ?? null)
  const spent = at.week === 'before' ? before : at.week === 'both' ? [...shown, ...before] : shown
  const days = new Map<string, AskedDay>()
  for (const guess of guessesIn(spent, row)) {
    const one = { date: guess.date, currency: guess.currency }
    if (!days.has(guessKey(one))) days.set(guessKey(one), one)
  }
  return { lines: guessesBehind(spent, row), days: [...days.values()] }
}

/** What a guessed line says: a borrowed day's, with its day; a missing currency's, with none. */
export function guessLabel(guess: Guess, today: string): string {
  const { date, currency, from } = guess
  if (from === null) return copy.reports.guesses.missing(currency)
  return copy.reports.guesses.borrowed(day(date, today), currency, from.rate, day(from.date, today))
}

/** The rates the popover's borrowed lines used, as rate.writeAll takes them, in order. */
export function nearestOf(lines: readonly Guess[]): InputOf<'rate.writeAll'>['rates'] {
  return lines.flatMap((line) =>
    line.from === null ? [] : [{ date: line.date, currency: line.currency, rate: line.from.rate }],
  )
}

/**
 * A row of the tree: a line of a level, and where it sits in it. An open category's children
 * follow it, a level deeper.
 */
export type TreeRow = ComparedLine &
  TreeSpot & {
    /** Its parent row's key; null at the top. */
    parent: string | null
  }

/**
 * The tree's rows: the top level, and under each open category its own level. `opened` holds the
 * categories that are open.
 */
export function treeRows(
  shown: readonly Spent[],
  before: readonly Spent[],
  opened: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const add = (level: string, depth: number, parent: string | null) => {
    const at = comparedAt(shown, before, level)
    at.lines.forEach((line, i) => {
      const row: TreeRow = {
        ...line,
        parent,
        level: depth,
        open: line.opens ? opened.has(line.category) : undefined,
        setsize: at.lines.length,
        posinset: i + 1,
      }
      rows.push(row)
      if (row.open === true) add(row.category, depth + 1, row.key)
    })
  }
  add('', 1, null)
  return rows
}

/** What a tree's key does: open or close a category, move to another row, or nothing. */
export type TreeMove = { toggle: string } | { active: string } | null

/**
 * Where `key` moves the tree from the row `active`: → opens a closed row or goes to its first
 * child, ← closes an open row or goes to its parent, Enter opens or closes.
 */
export function treeKey(rows: readonly TreeRow[], active: string | null, key: string): TreeMove {
  const at = rows.findIndex((r) => r.key === active)
  if (at < 0) return null
  const row = rows[at] as TreeRow
  if (key === 'Enter') return row.opens ? { toggle: row.category } : null
  if (key === 'ArrowRight') {
    if (!row.opens) return null
    if (row.open === false) return { toggle: row.category }
    const child = rows[at + 1]
    return child && child.parent === row.key ? { active: child.key } : null
  }
  if (key === 'ArrowLeft') {
    if (row.open === true) return { toggle: row.category }
    return row.parent === null ? null : { active: row.parent }
  }
  return null
}

/** A line's change: how much, and which way, never below zero. */
export type Change = { cents: number; way: 'more' | 'less' | 'same' }

/** This week less the week before, a dash counting as zero. */
export function changeOf(cents: number | null, before: number | null): Change {
  const [now, then] = [cents ?? 0, before ?? 0]
  const way = now > then ? 'more' : now < then ? 'less' : 'same'
  return { cents: Math.abs(now - then), way }
}

/** A tree's columns, in the order they read. */
export type TreeCell = 'name' | 'shown' | 'before' | 'change'

/** Below this width of tree, in CSS pixels, Last week goes: the tree runs out first. */
export const NARROW_TREE = 440

const TREE_WIDTHS: Record<TreeCell, string> = {
  name: 'minmax(0,1fr)',
  shown: '5em',
  before: '5em',
  change: '7em',
}

/** The cells a tree this wide shows, and their grid columns. */
export function treeColumnsOf(width: number): { cells: TreeCell[]; template: string } {
  const cells: TreeCell[] =
    width < NARROW_TREE ? ['name', 'shown', 'change'] : ['name', 'shown', 'before', 'change']
  return { cells, template: cells.map((cell) => TREE_WIDTHS[cell]).join(' ') }
}

/** The spends Reports asks main for: the week's, once each, whatever is selected. */
export function idsWanted(spent: readonly Spent[]): string[] {
  return [...new Set(spent.map((s) => s.id))]
}

/**
 * The spends beside the tree: behind the picked row, or, with none picked, every spend of the
 * week: in the list's order, newest first.
 */
export function spendsBehind(
  transactions: readonly ListedTransaction[],
  spent: readonly Spent[],
  picked: Pick<ComparedLine, 'holds' | 'category'> | undefined,
): ListedTransaction[] {
  const ids = new Set(spent.filter((s) => (picked ? isIn(s, picked) : true)).map((s) => s.id))
  return transactions.filter((t) => ids.has(t.id))
}

/** The week, the week before it, and the week's spends, from one load. */
export type WeekSpending = {
  report: Values['report.spending']
  earlier: Values['report.spending']
  spends: ListedTransaction[]
}

/** Reports' load: the week beside the week before, then its spends. The first failure wins. */
export async function weekSpending(
  ask: Ask<'report.spending' | 'transaction.get'>,
  week: Week,
): Promise<Wire<WeekSpending>> {
  const before = weekAfter(week, -1)
  const [report, earlier] = await Promise.all([
    ask('report.spending', { start: week.start, end: week.end }),
    ask('report.spending', { start: before.start, end: before.end }),
  ])
  if (!report.ok) return report
  if (!earlier.ok) return earlier
  const ids = idsWanted(spentOf(report.value))
  const spends: Wire<ListedTransaction[]> =
    ids.length === 0 ? { ok: true, value: [] } : await ask('transaction.get', { ids })
  if (!spends.ok) return spends
  return { ok: true, value: { report: report.value, earlier: earlier.value, spends: spends.value } }
}
