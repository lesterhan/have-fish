import type { PageServerLoad } from './$types'
import type { Account, Transaction, UserSettings } from '$lib/api'
import { TZ_OFFSET_COOKIE, defaultTransactionRange, parseTzOffset } from '$lib/date'

/**
 * Loads the page's data on the server instead of after hydration.
 *
 * The page used to boot empty and then fan out to /api/transactions, /api/accounts and
 * /api/user-settings from the browser — several round trips across the open internet before
 * the first row appeared, some of them chained behind onMount. Here they run beside each
 * other on the loopback hop to the backend, so the HTML the browser receives already has
 * the rows in it and the cost is one round trip instead of three or four.
 *
 * The repair-banner scan deliberately stays on the client: it walks the user's entire
 * multi-currency history, and it is an advisory banner — it must not hold up first paint.
 */
export const load: PageServerLoad = async ({ url, fetch, cookies }) => {
  const defaults = defaultTransactionRange(parseTzOffset(cookies.get(TZ_OFFSET_COOKIE)))
  const from = url.searchParams.get('from') ?? defaults.from
  const to = url.searchParams.get('to') ?? defaults.to
  const accountPath = url.searchParams.get('accountPath') ?? ''

  const query = new URLSearchParams({ from, to })
  if (accountPath) query.set('accountPath', accountPath)

  const [transactions, accounts, settings] = await Promise.all([
    fetch(`/api/transactions?${query}`).then((r) => r.json() as Promise<Transaction[]>),
    fetch('/api/accounts').then((r) => r.json() as Promise<Account[]>),
    fetch('/api/user-settings').then((r) => r.json() as Promise<UserSettings>),
  ])

  return { from, to, transactions, accounts, settings }
}
