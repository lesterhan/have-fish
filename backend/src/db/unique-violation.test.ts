import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'
import { db } from '.'
import { accounts } from './schema'
import { isUniqueViolation } from './unique-violation'

/** The error this build's driver throws, wrapped as Drizzle wraps it, for the given insert. */
async function thrownBy(insert: () => Promise<unknown>): Promise<unknown> {
  try {
    await insert()
  } catch (err) {
    return err
  }
  throw new Error('the insert was expected to throw')
}

describe('isUniqueViolation', () => {
  let userId: string
  beforeEach(async () => {
    await clearDatabase()
    const cookie = await createTestUser()
    const session = await request('/api/auth/get-session', { headers: { Cookie: cookie } })
    userId = ((await session.json()) as { user: { id: string } }).user.id
  })

  it("recognises a unique index refusing a row, through Drizzle's wrapper", async () => {
    const row = { userId, path: 'assets:bank', pathKey: 'assets:bank' }
    await db.insert(accounts).values(row)

    expect(isUniqueViolation(await thrownBy(() => db.insert(accounts).values(row)))).toBe(true)
  })

  it('is false for any other failed statement', async () => {
    // A user that does not exist: the foreign key, not the unique index.
    const orphan = { userId: 'nobody', path: 'assets:bank', pathKey: 'assets:bank' }
    expect(isUniqueViolation(await thrownBy(() => db.insert(accounts).values(orphan)))).toBe(false)
  })

  it('is false for things that are not errors, or carry no code', () => {
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation({ code: '23505' })).toBe(false)
    expect(isUniqueViolation(new Error('duplicate key'))).toBe(false)
  })
})
