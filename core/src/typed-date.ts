// A date typed the short way: `y`, `-3`, `mon`, `10-31`. Every short form means a day already
// here, today included; only a full `YYYY-MM-DD` can be in the future.

import { addDays, isCalendarDate, weekOf } from './calendar-date'

/** The words read as days, in English, lower case. They're typed, never shown. */
const NAMED: Record<string, number> = { t: 0, today: 0, y: 1, yesterday: 1 }

/** Each weekday's spellings, Monday first. */
const WEEKDAYS = [
  ['mon', 'monday'],
  ['tue', 'tues', 'tuesday'],
  ['wed', 'weds', 'wednesday'],
  ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
  ['sun', 'sunday'],
]

/** The calendar day `typed` means, seen from `today`; null for what it can't read. */
export function dateFrom(typed: string, today: string): string | null {
  const text = typed.trim().toLowerCase()
  const named = NAMED[text]
  if (named !== undefined) return addDays(today, -named)

  const ago = /^-(\d{1,4})$/.exec(text)
  if (ago) return addDays(today, -Number(ago[1]))

  const weekday = WEEKDAYS.findIndex((names) => names.includes(text))
  if (weekday !== -1) {
    const day = addDays(weekOf(today).start, weekday)
    return day > today ? addDays(day, -7) : day
  }

  const monthDay = /^(\d{1,2})-(\d{1,2})$/.exec(text)
  if (monthDay) return lastOn(Number(monthDay[1]), Number(monthDay[2]), today)

  return isCalendarDate(text) ? text : null
}

/** The most recent `month`-`day` on or before `today`, in the last few years; null if none is one. */
function lastOn(month: number, day: number, today: string): string | null {
  const year = Number(today.slice(0, 4))
  // Four years back reaches the last 29 February.
  for (let y = year; y > year - 5; y--) {
    const date = `${String(y).padStart(4, '0')}-${pad(month)}-${pad(day)}`
    if (isCalendarDate(date) && date <= today) return date
  }
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')
