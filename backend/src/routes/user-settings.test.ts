import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { userSettings } from '../db/schema'
import { clearDatabase, createTestUser, request } from '../test-utils'

describe('user-settings', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET seeds a row with the default income root path', async () => {
    const res = await request('/api/user-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { defaultIncomeRootPath: string }
    expect(body.defaultIncomeRootPath).toBe('income')
  })

  it('PATCH updates the income root path', async () => {
    const res = await request('/api/user-settings', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultIncomeRootPath: 'earnings' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { defaultIncomeRootPath: string }
    expect(body.defaultIncomeRootPath).toBe('earnings')
  })

  it('PATCH rejects an empty income root path', async () => {
    const res = await request('/api/user-settings', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultIncomeRootPath: '   ' }),
    })
    expect(res.status).toBe(400)
  })

  describe('PATCH preferences', () => {
    const patch = (body: unknown) =>
      request('/api/user-settings', {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const stored = async () => {
      const session = await request('/api/auth/get-session', { headers: { Cookie: cookie } })
      const userId = ((await session.json()) as { user: { id: string } }).user.id
      const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
      return { userId, preferences: row?.preferences as Record<string, unknown> | undefined }
    }

    it('keeps the keys a patch does not name', async () => {
      await patch({ preferences: { theme: 'graphite', hiddenAccountIds: ['a'] } })

      const res = await patch({ preferences: { theme: 'paper' } })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { preferences: unknown }
      expect(body.preferences).toEqual({ theme: 'paper', hiddenAccountIds: ['a'] })
      expect((await stored()).preferences).toEqual({ theme: 'paper', hiddenAccountIds: ['a'] })
    })

    it('replaces a nested value whole', async () => {
      await patch({ preferences: { layout: { sidebar: 'wide', grid: true } } })

      await patch({ preferences: { layout: { sidebar: 'narrow' } } })

      expect((await stored()).preferences).toEqual({ layout: { sidebar: 'narrow' } })
    })

    it('stores null as null', async () => {
      await patch({ preferences: { theme: 'graphite' } })

      await patch({ preferences: { theme: null } })

      expect((await stored()).preferences).toEqual({ theme: null })
    })

    it('changes preferences and a column in one request', async () => {
      const res = await patch({ preferredCurrency: 'eur', preferences: { theme: 'paper' } })

      const body = (await res.json()) as { preferredCurrency: string; preferences: unknown }
      expect(body.preferredCurrency).toBe('EUR')
      expect(body.preferences).toEqual({ theme: 'paper' })
    })

    it('creates the row for a user who has none', async () => {
      const { userId } = await stored()
      await db.delete(userSettings).where(eq(userSettings.userId, userId))

      const res = await patch({ preferences: { theme: 'paper' } })

      expect(res.status).toBe(200)
      expect((await stored()).preferences).toEqual({ theme: 'paper' })
    })

    it('refuses preferences that are not an object', async () => {
      for (const preferences of [null, ['a'], 'graphite']) {
        expect((await patch({ preferences })).status).toBe(400)
      }
    })

    // The merge reads the stored blob and writes the whole of it back, so without the row
    // lock two requests in flight at once would each write a blob missing the other's key.
    it('keeps every key when patches to different keys arrive at once', async () => {
      const keys = Array.from({ length: 12 }, (_, i) => `key${i}`)

      const results = await Promise.all(keys.map((k) => patch({ preferences: { [k]: true } })))

      expect(results.map((r) => r.status)).toEqual(keys.map(() => 200))
      expect(Object.keys((await stored()).preferences ?? {}).sort()).toEqual([...keys].sort())
    })

    it('keeps catch-up config written at the same time as another key', async () => {
      const account = await request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'assets:chequing' }),
      })
      const { id } = (await account.json()) as { id: string }

      await Promise.all([
        request(`/api/coverage/config/${id}`, {
          method: 'PATCH',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracked: false }),
        }),
        ...Array.from({ length: 6 }, (_, i) => patch({ preferences: { [`key${i}`]: true } })),
      ])

      const { preferences } = await stored()
      expect(preferences?.catchUp).toEqual({ [id]: { tracked: false } })
      expect(Object.keys(preferences ?? {})).toHaveLength(7)
    })
  })
})
