// A ledger row's rules: which way its money went, and the days a list held whole falls into.

import type { ListedDay, ListedTransaction } from '../shared/commands'
import type { Way } from './format'

const MINE = new Set(['assets', 'liabilities'])
const rootOf = (path: string | null) => path?.split(':')[0]

/** In from an income source; between two accounts of mine; out otherwise, which has no sign. */
export function wayOf({ fromPath, toPath }: Pick<ListedTransaction, 'fromPath' | 'toPath'>): Way {
  const [from, to] = [rootOf(fromPath), rootOf(toPath)]
  if (from === 'income') return 'in'
  return from && to && MINE.has(from) && MINE.has(to) ? 'between' : 'out'
}

/**
 * Each run of rows on one day, in order: the days of a list the window holds whole, such as a
 * report's spends. The ledger's list asks main for its days instead.
 */
export function daysOf(rows: readonly Pick<ListedTransaction, 'date'>[]): ListedDay[] {
  const days: ListedDay[] = []
  for (const { date } of rows) {
    const last = days.at(-1)
    if (last?.date === date) last.count++
    else days.push({ date, count: 1 })
  }
  return days
}

/** A ledger row's cells, in the order they read. */
export type Cell = 'from' | 'amount' | 'to' | 'description' | 'draft'

/**
 * Below this width of list, in CSS pixels, From goes. It's the list that runs out, not the window:
 * the list is half of it while a pane is beside it, and half again in Reports.
 */
export const NARROW_LIST = 520

// From, Amount, To, Description, and the ● of a draft (DESIGN.md, "Layout").
const WIDTHS: Record<Cell, string> = {
  from: 'min(196px,28%)',
  amount: '92px',
  to: 'minmax(0,1.2fr)',
  description: 'minmax(0,1fr)',
  draft: '1em',
}

/** The cells a ledger row shows in a list this wide, and their grid columns. */
export function columnsOf(width: number): { cells: Cell[]; template: string } {
  const cells: Cell[] = ['from', 'amount', 'to', 'description', 'draft']
  const shown = width < NARROW_LIST ? cells.slice(1) : cells
  return { cells: shown, template: shown.map((c) => WIDTHS[c]).join(' ') }
}
