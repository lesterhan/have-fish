// A transaction's date is a calendar day, `YYYY-MM-DD`, kept and compared as text

// `YYYY-MM-DD`, the shape of a calendar date.
export const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Whether `value` is a `YYYY-MM-DD` that names a real day (no 2026-02-30).
 *
 * The `Date` here reads no clock: it parses a fixed UTC midnight, and an impossible day rolls
 * over (`2026-02-30` becomes March 2nd), so it fails to print back as the same text.
 */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

const DAY_PARTS = { year: 'numeric', month: '2-digit', day: '2-digit' } as const

/**
 * The calendar day `now` (UTC ms) falls on in `timeZone` (an IANA name). Pure: the caller
 * passes both, as it does `now` everywhere in the core.
 */
export function calendarDateAt(now: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, ...DAY_PARTS }).formatToParts(now)
  const part = (type: keyof typeof DAY_PARTS) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`
}

/** The day `days` after `date` (before, when negative). `date` must be a calendar date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The week `date` falls in, Monday to Sunday, both days in it. */
export function weekOf(date: string): { start: string; end: string } {
  // getUTCDay counts from Sunday; a week here starts on Monday.
  const sinceMonday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  const start = addDays(date, -sinceMonday)
  return { start, end: addDays(start, 6) }
}
