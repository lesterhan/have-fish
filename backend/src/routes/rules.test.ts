import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { accounts } from '../db/schema'

async function createAccount(userId: string, path: string) {
  const [acct] = await db.insert(accounts).values({ userId, path }).returning()
  return acct
}

describe('rules', () => {
  let cookie: string
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    // Extract userId from session
    const sessionRes = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
    const session = await sessionRes.json()
    userId = session.user.id
  })

  it('creates a rule and fetches it', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')

    const createRes = await app.request('/api/rules', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'LOBLAWS', accountId: acct.id }),
    })
    expect(createRes.status).toBe(201)

    const listRes = await app.request('/api/rules', { headers: { Cookie: cookie } })
    expect(listRes.status).toBe(200)
    const rules = await listRes.json()
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].pattern).toBe('LOBLAWS')
    expect(rules[0].status).toBe('active')
    expect(rules[0].accountPath).toBe('expenses:food:groceries')
  })
})
