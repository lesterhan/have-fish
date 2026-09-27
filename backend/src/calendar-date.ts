// A transaction's date is a calendar day, `YYYY-MM-DD`, stored and compared as text (#277).
// It is never an instant: no time of day, no time zone, and nothing here ever reads the
// time zone of the machine it runs on, except the one place a bank's own date format has
// to be handed to the JS parser (`calendarDateFromText`), where the local reading is the
// date as written.
//
// Before #277 the column was a timestamp. A date made by `new Date(text)` landed on local
// midnight, which on a machine east of UTC is the previous day in UTC, and the ledger then
// showed, grouped and covered the row a day early (things-missed M1). Text dates compare
// correctly as strings, so `gte`, `lte`, `between`, `MIN`, `MAX` and `ORDER BY` all work on
// them unchanged, in Postgres and in SQLite.

/** `YYYY-MM-DD`, the shape of a calendar date. Says nothing about whether the day exists. */
export const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Whether `value` is a `YYYY-MM-DD` that names a real day (no 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/**
 * The calendar date a value sent to the ledger names: a `YYYY-MM-DD` as it is, or the date
 * part of an ISO timestamp as written, which for one ending in `Z` is the UTC day the old
 * timestamp column stored. Throws on anything else, because a row with no real date must
 * never be written.
 */
export function calendarDateOf(value: string): string {
  const date = value.slice(0, 10)
  if (isCalendarDate(date) && (value.length === 10 || value[10] === 'T' || value[10] === ' ')) {
    return date
  }
  throw new RangeError(`not a calendar date: "${value}"`)
}

/**
 * The calendar date a bank wrote in a CSV cell, or null when it can't be read.
 *
 * A cell that starts with `YYYY-MM-DD` is that date, whatever time or offset follows: the
 * bank's day is the day it wrote. Any other format goes to the JS date parser, which reads
 * it as local midnight, so its local fields are the date as written, in any time zone. The
 * old code took the UTC date of that instant instead, which moved every such row a day
 * earlier on a machine east of UTC. Day-first formats (`12/09/2026`) are still read the JS
 * way, month first; that needs a per-parser format, not a guess.
 */
export function calendarDateFromText(text: string): string | null {
  const trimmed = text.trim()
  const iso = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(trimmed)
  if (iso?.[1]) return isCalendarDate(iso[1]) ? iso[1] : null
  if (!trimmed) return null
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `date` moved by `days` whole days. Calendar arithmetic, so it never crosses a zone. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}
