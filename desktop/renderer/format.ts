// How money and days read, everywhere the window shows them (DESIGN.md, "Money and days"). No
// component builds either itself: `tools/formats.ts` holds them to it (see #609).

import { calendarDateAt } from '@have-fish/core/calendar-date'
import { minorUnits } from '@have-fish/core/currencies'
import { dateFrom } from '@have-fish/core/typed-date'
import type { Money } from '../shared/commands'
import { HOME_CURRENCY } from '../shared/currency'

/** Grouped thousands, by the currency's decimals: at least its own, and any the amount carries. */
const AMOUNT = new Map(
  ([0, 2] as const).map((units) => [
    units,
    new Intl.NumberFormat('en-GB', { minimumFractionDigits: units, maximumFractionDigits: 2 }),
  ]),
)

/**
 * An amount as it reads: `1,234.50`, `1,500 JPY`, `−32.69`. The home currency goes unsaid unless
 * `code` asks for it, as a transaction's details do. Formatted from the decimal string, which
 * `Intl` reads exactly, so the amount is never a float.
 */
export function money(amount: string, currency: string, { code = false } = {}): string {
  const parts = moneyParts(amount, currency, { code })
  return parts.code === null ? parts.figure : `${parts.figure} ${parts.code}`
}

/** Which way a row's money went: out (no sign), in (`+`), or between my accounts (`⇄`). */
export type Way = 'out' | 'in' | 'between'

const SIGN = { out: null, in: '+', between: '⇄' } as const

/**
 * An amount in the pieces `Money` sets apart: the sign that says which way it went, the figure,
 * and the code when it's said.
 */
export function moneyParts(
  amount: string,
  currency: string,
  { code = false, way = 'out' as Way } = {},
): { sign: '+' | '⇄' | null; figure: string; code: string | null } {
  const format = AMOUNT.get(minorUnits(currency)) as Intl.NumberFormat
  const figure = format.format(amount as Intl.StringNumericLiteral).replace('-', '−')
  return { sign: SIGN[way], figure, code: code || currency !== HOME_CURRENCY ? currency : null }
}

/** What a transaction moved, each currency's amount as `money` writes it. */
export const amountsText = (amounts: readonly Money[], { code = false } = {}) =>
  amounts.map(({ amount, currency }) => money(amount, currency, { code })).join(' · ')

/** Today's date, `YYYY-MM-DD`, where this machine is: what a new spend's date starts at. */
export const todayIn = (
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) => calendarDateAt(now, timeZone)

/**
 * The day a date field means, typed the short way (`y`, `-3`, `mon`, `10-31`); what it can't read
 * goes as typed, for main to refuse.
 */
export const dayOf = (typed: string, today = todayIn()) => dateFrom(typed, today) ?? typed.trim()

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A day in its pieces: the date list shows the year always, and quiet. */
export type DayParts = {
  weekday: string
  day: string
  month: string
  year: string
}

/** The pieces of a day: `Thu`, `5`, `Nov`, `2026`. */
export function dayParts(date: string): DayParts {
  const parts = DAY.formatToParts(new Date(`${date}T00:00:00Z`))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value as string
  return { weekday: part('weekday'), day: part('day'), month: part('month'), year: part('year') }
}

/** A day as it reads: `Thu 5 Nov`, with the year when it isn't `today`'s. */
export function day(date: string, today: string): string {
  const parts = dayParts(date)
  const words = [parts.weekday, parts.day, parts.month]
  if (date.slice(0, 4) !== today.slice(0, 4)) words.push(parts.year)
  return words.join(' ')
}

/** How many days before `today` a moment's day was, where I am: 0 the same day, 1 yesterday. */
export function daysSince(
  at: number,
  today: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): number {
  const then = calendarDateAt(at, timeZone)
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${then}T00:00:00Z`)) / 86_400_000
}

const MOMENT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}

/** When something was made, where I am: `Thu 5 Nov 2026, 12:40`, from UTC ms. */
export function moment(at: number, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { ...MOMENT, timeZone }).formatToParts(
    new Date(at),
  )
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`
}

/** The date a date field understood, for a `Day` to show. Null for nothing typed, or unreadable. */
export const understood = (typed: string, today = todayIn()): string | null =>
  typed.trim() === '' ? null : dateFrom(typed, today)

/** A day band's day, and whether it's today or yesterday, which the band says before it. */
export function bandDay(
  date: string,
  today: string,
): { lead: 'today' | 'yesterday' | null; day: string } {
  const lead = date === today ? 'today' : date === dateFrom('y', today) ? 'yesterday' : null
  return { lead, day: day(date, today) }
}
