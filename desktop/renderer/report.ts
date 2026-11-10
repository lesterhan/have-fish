// The Reports place's rules: the week it shows, how each row reads, the tree it draws, and the
// spends beside it.

import { addDays, weekOf } from '@have-fish/core/calendar-date'
import { cents, format } from '@have-fish/core/money'
import { type ComparedLine, comparedAt, isIn, type Spent } from '@have-fish/core/spending'
import { copy } from '../copy'
import type { ListedTransaction, Money, Values } from '../shared/commands'
import { amountsText } from './format'
import type { TreeSpot } from './parts/listbox'

export type Week = { start: string; end: string }

/** The week `today` is in. */
export const thisWeek = (today: string): Week => weekOf(today)

/** The week `by` weeks after `week`; before it, when negative. */
export const weekAfter = (week: Week, by: number): Week => weekOf(addDays(week.start, by * 7))

/** What the report sums, in cents. */
export const spentOf = (report: Values['report.spending']): Spent[] =>
  report.spent.map((s) => ({ id: s.id, category: s.category, cents: cents(s.amount) }))

/** How a line names itself. */
export function lineLabel(line: Pick<ComparedLine, 'kind' | 'label'>): string {
  if (line.kind === 'unsorted') return copy.reports.tree.unsorted
  if (line.kind === 'own') return copy.reports.tree.own(line.label)
  return line.label
}

/** A report's sum, for `Money`. */
export const moneyOf = (cents: number, currency: string): Money => ({
  amount: format(cents),
  currency,
})

/** What went out in other currencies, said once, or null when there was none. */
export const otherText = (other: Values['report.spending']['other']) =>
  other.length === 0 ? null : copy.reports.tree.other(amountsText(other))

/**
 * A row of the tree: a line of a level, and where it sits in it. An open category's children
 * follow it, a level deeper.
 */
export type TreeRow = ComparedLine &
  TreeSpot & {
    /** Its parent row's key; null at the top. */
    parent: string | null
  }

/**
 * The tree's rows: the top level, and under each open category its own level. `opened` holds the
 * categories that are open.
 */
export function treeRows(
  shown: readonly Spent[],
  before: readonly Spent[],
  opened: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const add = (level: string, depth: number, parent: string | null) => {
    const at = comparedAt(shown, before, level)
    const here: TreeRow[] = at.lines.map((line, i) => ({
      ...line,
      parent,
      level: depth,
      open: line.opens ? opened.has(line.category) : undefined,
      setsize: at.lines.length,
      posinset: i + 1,
    }))
    rows.push(...here)
    for (const row of here) if (row.open === true) add(row.category, depth + 1, row.key)
  }
  add('', 1, null)
  return rows
}

/** What a tree's key does: open or close a category, move to another row, or nothing. */
export type TreeMove = { toggle: string } | { active: string } | null

/**
 * Where `key` moves the tree from the row `active`: → opens a closed row or goes to its first
 * child, ← closes an open row or goes to its parent, Enter opens or closes.
 */
export function treeKey(rows: readonly TreeRow[], active: string | null, key: string): TreeMove {
  const at = rows.findIndex((r) => r.key === active)
  if (at < 0) return null
  const row = rows[at] as TreeRow
  if (key === 'Enter') return row.opens ? { toggle: row.category } : null
  if (key === 'ArrowRight') {
    if (!row.opens) return null
    if (row.open === false) return { toggle: row.category }
    const child = rows[at + 1]
    return child && child.parent === row.key ? { active: child.key } : null
  }
  if (key === 'ArrowLeft') {
    if (row.open === true) return { toggle: row.category }
    return row.parent === null ? null : { active: row.parent }
  }
  return null
}

/**
 * The selection once `category` closes: its own row when what was selected was under it, and
 * nothing above it moves.
 */
export function closedOver(
  rows: readonly TreeRow[],
  selected: string | null,
  category: string,
): string | null {
  if (selected === null) return null
  const closing = `category:${category}`
  const at = new Map(rows.map((r) => [r.key, r]))
  let row = at.get(selected)
  while (row !== undefined && row.parent !== null) {
    if (row.parent === closing) return closing
    row = at.get(row.parent)
  }
  return selected
}

/** A line's change: how much, and which way, never below zero. */
export type Change = { cents: number; way: 'more' | 'less' | 'same' }

/** This week less the week before, a dash counting as zero. */
export function changeOf(cents: number | null, before: number | null): Change {
  const [now, then] = [cents ?? 0, before ?? 0]
  const way = now > then ? 'more' : now < then ? 'less' : 'same'
  return { cents: Math.abs(now - then), way }
}

/** A tree's columns, in the order they read. */
export type TreeCell = 'name' | 'shown' | 'before' | 'change'

/** Below this width of tree, in CSS pixels, Last week goes: the tree runs out first. */
export const NARROW_TREE = 440

const TREE_WIDTHS: Record<TreeCell, string> = {
  name: 'minmax(0,1fr)',
  shown: '5em',
  before: '5em',
  change: '7em',
}

/** The cells a tree this wide shows, and their grid columns. */
export function treeColumnsOf(width: number): { cells: TreeCell[]; template: string } {
  const cells: TreeCell[] =
    width < NARROW_TREE ? ['name', 'shown', 'change'] : ['name', 'shown', 'before', 'change']
  return { cells, template: cells.map((cell) => TREE_WIDTHS[cell]).join(' ') }
}

/** The spends Reports asks main for: the week's, once each, whatever is selected. */
export function idsWanted(spent: readonly Spent[]): string[] {
  return [...new Set(spent.map((s) => s.id))]
}

/**
 * The spends beside the tree: behind the picked row, or, with none picked, every spend of the
 * week: in the list's order, newest first.
 */
export function spendsBehind(
  transactions: readonly ListedTransaction[],
  spent: readonly Spent[],
  picked: Pick<ComparedLine, 'kind' | 'category'> | undefined,
): ListedTransaction[] {
  const ids = new Set(spent.filter((s) => (picked ? isIn(s, picked) : true)).map((s) => s.id))
  return transactions.filter((t) => ids.has(t.id))
}
