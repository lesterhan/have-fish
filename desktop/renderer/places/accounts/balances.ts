// The Accounts list's tree under its roots, and how each row says what's in it or owed on it.

import { pathFor } from '@have-fish/core/account-path'
import { balanceRows, type Total } from '@have-fish/core/balances'
import { cents, format } from '@have-fish/core/money'
import type { ListedAccount, Money } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'

/** One row of the list: an account I added, or a parent its name implies (no account). */
export type AccountRow = {
  key: string
  account: ListedAccount | undefined
  /** `assets`, `liabilities`: the band it's under. */
  root: string
  label: string
  depth: number
  /** What's in it, by currency, for `Money`; owed where it's what I owe. */
  balance: Balance[]
  totals: readonly Total[]
}

/**
 * A cell of an account's row: its name, kind and balance. Its currency is in its pane; the balance
 * says any code but the home one.
 */
export type AccountCell = 'name' | 'kind' | 'balance'

const WIDTHS: Record<AccountCell, string> = {
  name: 'minmax(0,1fr)',
  kind: '9rem',
  balance: 'minmax(7rem,auto)',
}

/**
 * Below this width of list, in CSS pixels, Kind goes: the pane says it, and a name needs the room
 * more (DESIGN.md, "Layout"). The list is beside the pane, so it runs out before the window does.
 */
export const NARROW_ACCOUNTS = 480

/** The cells an account row shows in a list this wide, and their grid columns. */
export function accountColumnsOf(width: number): { cells: AccountCell[]; template: string } {
  const cells: AccountCell[] = ['name', 'kind', 'balance']
  const shown = width < NARROW_ACCOUNTS ? cells.filter((c) => c !== 'kind') : cells
  return { cells: shown, template: shown.map((c) => WIDTHS[c]).join(' ') }
}

/** A root's band: how many rows are under it, and what they come to. */
export type AccountGroup = { root: string; count: number; total: Balance[] }

/** The roots in the order they show: what I have, then what I owe, then any other. */
const ROOTS = ['assets', 'liabilities']
const rank = (root: string) => (ROOTS.includes(root) ? ROOTS.indexOf(root) : ROOTS.length)

export type Balance = { money: Money; owed: boolean }

/**
 * The accounts as a tree under their roots, assets first: each parent above its children, with
 * their money rolled into it.
 */
export function accountRows(accounts: readonly ListedAccount[]): AccountRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const held = accounts.map((a) => ({
    id: a.id,
    path: pathFor(a.kind, a.name),
    totals: a.balance.map((m) => ({ currency: m.currency, cents: cents(m.amount) })),
  }))
  const rows = balanceRows(held).map((row) => {
    const account = row.id === null ? undefined : byId.get(row.id)
    return {
      key: row.path,
      account,
      root: row.root,
      label: row.label,
      depth: row.depth,
      balance: balanceOf(row.totals, row.root, account?.currency ?? HOME_CURRENCY),
      totals: row.totals,
    }
  })
  // Stable, so each parent keeps its children under it.
  return rows.sort(
    (a, b) => rank(a.root) - rank(b.root) || (a.root < b.root ? -1 : a.root > b.root ? 1 : 0),
  )
}

/** The bands over `rows`, one per root, in their order: each root's rows and their sum. */
export function accountGroups(rows: readonly AccountRow[]): AccountGroup[] {
  const groups: (AccountGroup & { sums: Map<string, number> })[] = []
  for (const row of rows) {
    let group = groups.at(-1)
    if (group?.root !== row.root) {
      group = { root: row.root, count: 0, total: [], sums: new Map() }
      groups.push(group)
    }
    group.count++
    // The top level holds everything under it.
    if (row.depth > 0) continue
    for (const { currency, cents } of row.totals)
      group.sums.set(currency, (group.sums.get(currency) ?? 0) + cents)
  }
  return groups.map(({ sums, ...group }) => ({
    ...group,
    total: balanceOf(
      [...sums]
        .filter(([, cents]) => cents !== 0)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([currency, cents]) => ({ currency, cents })),
      group.root,
      HOME_CURRENCY,
    ),
  }))
}

/**
 * What's in it, by currency. Under `liabilities`, below zero is what I owe, shown above zero and
 * said so. Nothing in it is zero in `currency`.
 */
export function balanceOf(totals: readonly Total[], root: string, currency: string): Balance[] {
  if (totals.length === 0) return [{ money: { amount: format(0), currency }, owed: false }]
  return totals.map(({ currency, cents }) => {
    const owed = root === 'liabilities' && cents < 0
    return { money: { amount: format(owed ? -cents : cents), currency }, owed }
  })
}
