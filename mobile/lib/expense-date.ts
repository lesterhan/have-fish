/**
 * Date model for the Add screen's date chip + Date sheet.
 *
 * Kept free of any React Native / expo import so it can be unit-tested under
 * `bun test` (the RN modules don't parse there). The sheet UI and the native
 * picker live in `components/DateSheet.tsx`.
 *
 * Dates are local-calendar `YYYY-MM-DD` strings — the same convention the web
 * app uses (`frontend/src/lib/date.ts`), never `toISOString().slice(0, 10)`
 * (which is UTC and shifts the day for non-UTC users).
 */

export type DateMode = 'today' | 'yesterday' | 'pick'

/** Format a Date as a local-calendar `YYYY-MM-DD` string (not UTC). */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Today's local ISO date. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now)
}

/** Yesterday's local ISO date. */
export function yesterdayISO(now: Date = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - 1)
  return toISODate(d)
}

/**
 * Clamp an ISO date so it never lands in the future. ISO `YYYY-MM-DD` strings
 * sort lexically, so a string compare is enough — no Date parsing needed.
 */
export function clampISO(iso: string, now: Date = new Date()): string {
  const today = todayISO(now)
  return iso > today ? today : iso
}

/**
 * Resolve the chosen mode to the concrete ISO `date` sent to `createExpense`.
 * A picked date is clamped to today as a defence-in-depth backstop for the
 * picker's `maximumDate`.
 */
export function resolveDate(mode: DateMode, pickISO: string | null, now: Date = new Date()): string {
  switch (mode) {
    case 'yesterday':
      return yesterdayISO(now)
    case 'pick':
      return clampISO(pickISO ?? todayISO(now), now)
    case 'today':
    default:
      return todayISO(now)
  }
}

/**
 * Human label for the date chip. Resolves relative to *today* rather than the
 * raw mode so a date picked to be today/yesterday reads naturally; anything
 * older shows its ISO string.
 */
export function dateLabel(iso: string, now: Date = new Date()): string {
  if (iso === todayISO(now)) return 'Today'
  if (iso === yesterdayISO(now)) return 'Yesterday'
  return iso
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/**
 * Short `Mon D` label for a local-calendar ISO date (e.g. `2026-06-18` →
 * `Jun 18`). Used by the History feed. Parses the string parts directly rather
 * than `new Date(iso)` (which interprets a bare date as UTC midnight and can
 * shift the day for negative-offset users). A malformed string is returned
 * unchanged so the feed never renders `NaN`.
 */
export function monthDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return iso
  return `${MONTHS[m - 1]} ${d}`
}
