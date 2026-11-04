// How the list writes what a transaction moved, and the day it is.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import { dateFrom } from '@have-fish/core/typed-date'
import type { ListedTransaction } from '../shared/commands'

export const amountsText = (amounts: ListedTransaction['amounts']) =>
  amounts.map(({ amount, currency }) => `${amount} ${currency}`).join(' · ')

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

/**
 * What a date field understood, as a person reads a day: `Sat 31 Oct`, with the year when it isn't
 * this one. Null for nothing typed, or nothing it can read.
 */
export function understood(typed: string, today = todayIn()): string | null {
  if (typed.trim() === '') return null
  const date = dateFrom(typed, today)
  if (date === null) return null
  const parts = DAY.formatToParts(new Date(`${date}T00:00:00Z`))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  const day = [part('weekday'), part('day'), part('month')]
  if (date.slice(0, 4) !== today.slice(0, 4)) day.push(part('year'))
  return day.join(' ')
}
