import { db } from './db'
import { user, accounts, transactions, postings, csvParsers, userSettings } from './db/schema'
import { app } from './app'

// Wipe all rows in dependency order (postings → transactions → userSettings → csvParsers → accounts → users)
export async function clearDatabase() {
  await db.delete(postings)
  await db.delete(transactions)
  await db.delete(userSettings)
  await db.delete(csvParsers)
  await db.delete(accounts)
  await db.delete(user)
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
