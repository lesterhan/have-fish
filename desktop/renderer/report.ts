// The Reports place's rules: the week it shows, how each line reads, and the spends behind it.

import { addDays, weekOf } from '@have-fish/core/calendar-date'
import { cents, format } from '@have-fish/core/money'
import { isIn, isUnder, type SpendingLine, type Spent } from '@have-fish/core/spending'
import { copy } from '../copy'
import type { ListedTransaction, Values } from '../shared/commands'
import { amountsText, money } from './format'

export type Week = { start: string; end: string }

/** The week `today` is in. */
export const thisWeek = (today: string): Week => weekOf(today)

/** The week `by` weeks after `week`; before it, when negative. */
export const weekAfter = (week: Week, by: number): Week => weekOf(addDays(week.start, by * 7))

/** What the report sums, in cents. */
export const spentOf = (report: Values['report.spending']): Spent[] =>
  report.spent.map((s) => ({ id: s.id, category: s.category, cents: cents(s.amount) }))

/** How a line names itself. */
export function lineLabel(line: Pick<SpendingLine, 'kind' | 'label'>): string {
  if (line.kind === 'unsorted') return copy.reports.breakdown.unsorted
  if (line.kind === 'own') return copy.reports.breakdown.own(line.label)
  return line.label
}

/** A report's sum, as money reads. */
export const moneyText = (cents: number, currency: string) => money(format(cents), currency)

/** What went out in other currencies, said once, or null when there was none. */
export const otherText = (other: Values['report.spending']['other']) =>
  other.length === 0 ? null : copy.reports.breakdown.other(amountsText(other))

/**
 * The spends Reports asks main for: the week's under the level shown, so picking a line needs no
 * ask, and any with a draft, so a draft's spend is there to save. Ids, in no order.
 */
export function idsWanted(
  spent: readonly Spent[],
  level: string,
  drafted: Iterable<string>,
): string[] {
  return [...new Set([...spent.filter((s) => isUnder(s, level)).map((s) => s.id), ...drafted])]
}

/**
 * The spends behind the picked line, or, with none picked, behind the level: in the list's order,
 * newest first.
 */
export function spendsBehind(
  transactions: readonly ListedTransaction[],
  spent: readonly Spent[],
  level: string,
  picked: Pick<SpendingLine, 'kind' | 'category'> | undefined,
): ListedTransaction[] {
  const ids = new Set(
    spent.filter((s) => (picked ? isIn(s, picked) : isUnder(s, level))).map((s) => s.id),
  )
  return transactions.filter((t) => ids.has(t.id))
}
