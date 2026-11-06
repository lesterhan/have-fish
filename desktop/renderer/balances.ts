// The Accounts list's tree, and how each row says what's in it or owed on it.

import { pathFor } from '@have-fish/core/account-path'
import { balanceRows, type Total } from '@have-fish/core/balances'
import { cents, format } from '@have-fish/core/money'
import { copy } from '../copy'
import type { ListedAccount } from '../shared/commands'
import { HOME_CURRENCY } from '../shared/currency'
import { money } from './format'

/** One row of the list: an account I added, or a parent its name implies (no account). */
export type AccountRow = {
  key: string
  account: ListedAccount | undefined
  label: string
  depth: number
  balance: string
}

/** The accounts as a tree: each parent above its children, with their money rolled into it. */
export function accountRows(accounts: readonly ListedAccount[]): AccountRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const held = accounts.map((a) => ({
    id: a.id,
    path: pathFor(a.kind, a.name),
    totals: a.balance.map((m) => ({ currency: m.currency, cents: cents(m.amount) })),
  }))
  return balanceRows(held).map((row) => {
    const account = row.id === null ? undefined : byId.get(row.id)
    return {
      key: row.path,
      account,
      label: row.label,
      depth: row.depth,
      balance: balanceText(row.totals, row.root, account?.currency ?? HOME_CURRENCY),
    }
  })
}

/**
 * What's in it, by currency. Under `liabilities`, below zero is what I owe, shown above zero and
 * said so. Nothing in it is zero in `currency`.
 */
export function balanceText(totals: readonly Total[], root: string, currency: string): string {
  if (totals.length === 0) return money(format(0), currency)
  return totals
    .map(({ currency, cents }) =>
      root === 'liabilities' && cents < 0
        ? copy.accounts.owed(money(format(-cents), currency))
        : money(format(cents), currency),
    )
    .join(' · ')
}
