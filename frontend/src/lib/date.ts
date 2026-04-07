/**
 * Date utility helpers.
 * All date formatting in the app should go through these functions — never
 * call `.toISOString().slice(0, 10)` directly.
 */

/**
 * Formats a Date as a YYYY-MM-DD string (local calendar date, not UTC).
 * Use this everywhere a date string is needed for display or API params.
 */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Parses a free-text date range string into { from, to } ISO date strings.
 * Returns null if the input cannot be parsed.
 *
 * Supported formats:
 *   - Relative shorthand: "2 weeks", "6mo", "90d", "3 months"
 *     → from = today minus that duration, to = today
 *   - ISO date range:     "2026-02-20 to 2026-03-08"
 *     → from = first date, to = second date
 *   - Single ISO date:    "2026-01-01"
 *     → from = that date, to = today
 */
function isValidDate(isoDate: string): boolean {
  const d = new Date(isoDate)
  return !isNaN(d.getTime())
}

export function parseCustomDateRange(input: string): { from: string; to: string } | null {
  const s = input.trim().toLowerCase()
  const today = new Date()

  const relative = s.replace(/^past\s+/, '').match(/^(\d+)\s*(d|day|days|w|wk|wks|week|weeks|mo|mos|mon|mons|month|months)$/)
  if (relative) {
    const num = parseInt(relative[1])
    const unit = relative[2]
    const days =
      unit.startsWith('w') ? num * 7
        : unit.startsWith('mo') ? num * 31
          : num // d/day/days
    const from = new Date(today)
    from.setDate(today.getDate() - days)
    return { from: toISODate(from), to: toISODate(today) }
  }

  const single = s.match(/^\d{4}-\d{2}-\d{2}$/)
  if (single) {
    if (!isValidDate(s)) return null
    return { from: s, to: toISODate(today) }
  }

  const range = s.match(/^(\d{4}-\d{2}-\d{2})\s*(to|-)\s*(\d{4}-\d{2}-\d{2})$/)
  if (range) {
    if (!isValidDate(range[1]) || !isValidDate(range[3])) return null
    return { from: range[1], to: range[3] }
  }

  return null
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function monthEnd(year: number, month: number): string {
  const last = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}
