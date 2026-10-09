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
