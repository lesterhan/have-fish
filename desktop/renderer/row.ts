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
