import { app } from './app'
import { db } from './db'
import {
  accountCoverage,
  accounts,
  csvParsers,
  expenseGroupInvites,
  expenseGroupMembers,
  expenseGroups,
  fxRates,
  groupExpenseSplits,
  groupExpenses,
  groupSettlements,
  importRules,
  postings,
  transactions,
  user,
  userSettings,
} from './db/schema'

// Wipe all rows in dependency order (postings → transactions → userSettings → csvParsers → accounts → users)
// fxRates is global (not per-user) but still cleared to keep tests hermetic.
export async function clearDatabase() {
  await db.delete(postings)
  await db.delete(transactions)
  await db.delete(importRules)
  await db.delete(userSettings)
  await db.delete(csvParsers)
  // accountCoverage has FKs to both user and accounts
  await db.delete(accountCoverage)
  // Fish Pie tables deleted before accounts — expenseGroupMembers has a FK to accounts
  await db.delete(groupExpenseSplits)
  await db.delete(groupExpenses)
  await db.delete(groupSettlements)
  await db.delete(expenseGroupInvites)
  await db.delete(expenseGroupMembers)
  await db.delete(expenseGroups)
  await db.delete(accounts)
  await db.delete(user)
  await db.delete(fxRates)
}

/**
 * The entry a test is asserting is there.
 *
 * `body[0].postings` and `byAccount[food.id].role` both assert something silently: that
 * the list came back non-empty, that the posting landed on the account it was supposed to.
 * `noUncheckedIndexedAccess` makes those assertions something the test has to write down,
 * and writing them here rather than as `!` at each site means a response that came back
 * short fails with a sentence naming what was missing, instead of with `Cannot read
 * properties of undefined` several lines later.
 */
export function at<T>(
  from: readonly T[] | Readonly<Record<string, T>>,
  key: string | number = 0,
): T {
  const entry = (from as Readonly<Record<string | number, T | undefined>>)[key]
  if (entry === undefined) {
    const had = Array.isArray(from)
      ? `length ${from.length}`
      : `keys ${Object.keys(from).join(', ') || '(none)'}`
    throw new Error(`nothing at [${String(key)}] — ${had}`)
  }
  return entry
}

/**
 * `app.request`, as the promise it always returns.
 *
 * Hono types it `Response | Promise<Response>` because a handler is allowed to be
 * synchronous. None here are, and `await` hides the difference everywhere except in a
 * `.then` chain, where the union has no `.then` to call — which is most of what
 * `tsconfig.check.json` used to mean by "pre-existing errors in the test bodies".
 *
 * `Promise.resolve` narrows it for real rather than by assertion: a no-op on a promise,
 * and a wrapper on the value that never arrives. `await app.request(...)` needs none of
 * this and stays as it is.
 */
export function request(...args: Parameters<typeof app.request>): Promise<Response> {
  return Promise.resolve(app.request(...args))
}

// Signs up a fresh test user and returns the session Cookie header string.
// Pass the returned value as the Cookie header on subsequent requests:
//   app.request('/api/accounts', { headers: { Cookie: cookie } })
export async function createTestUser(
  email = 'test@example.com',
  password = 'password123',
): Promise<string> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Test User' }),
  })
  // Better Auth returns the session cookie on sign-up
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('Sign-up did not return a session cookie')
  return cookie
}
