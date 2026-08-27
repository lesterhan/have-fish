import { MONTH_NAMES } from '$lib/date'

/**
 * The muted line beside the date field: what you are actually looking at.
 *
 * The date field keeps its preset label ("3 months") because it is a text input you type
 * presets into — the label is the affordance. But a preset name does not tell you which
 * days are on screen, and the page says "Covered through Jun 20" two bands above. Two date
 * vocabularies on one screen is the problem; spelling the range out next to the preset is
 * the fix, and it costs no extra control.
 */
export function rangeSummary(
  from: string,
  to: string,
  entries: number,
): string {
  const count = `${entries} ${entries === 1 ? 'entry' : 'entries'}`
  const range = `${shortDate(from)} → ${shortDate(to)}`
  return `${range} · ${count}`
}

/** "2026-05-27" → "May 27". Bad input is passed through rather than rendered as NaN. */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const month = MONTH_NAMES[Number(m[2]) - 1]
  if (!month) return iso
  return `${month.substring(0, 3)} ${Number(m[3])}`
}
