import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { accounts, userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { effectiveConfig, readCatchUpOverrides } from './horizon'

async function createAccount(userId: string, path: string) {
  const [acct] = await db.insert(accounts).values({ userId, path }).returning()
  return acct
}

async function userIdFor(cookie: string) {
  const res = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
  return (await res.json()).user.id as string
}

async function patchConfig(cookie: string, accountId: string, body: Record<string, unknown>) {
  return app.request(`/api/coverage/config/${accountId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

async function postCoverage(cookie: string, accountId: string, fromDate: string, throughDate: string) {
  return app.request('/api/coverage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ accountId, fromDate, throughDate, source: 'import' }),
  })
}

// Three consecutive statements closing on the 25th — the minimum inference will act on.
async function seedMonthlyStatements(cookie: string, accountId: string) {
  await postCoverage(cookie, accountId, '2025-04-26', '2025-05-25')
  await postCoverage(cookie, accountId, '2025-05-26', '2025-06-25')
  await postCoverage(cookie, accountId, '2025-06-26', '2025-07-25')
}

async function storedPreferences(userId: string) {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  return row?.preferences as Record<string, unknown> | undefined
}

describe('coverage config', () => {
  let cookie: string
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    userId = await userIdFor(cookie)
  })

  // The GET returns the merged config, which cannot say whether a value was inferred or
  // pinned by hand — and "hand it back to automatic" is the whole point of clearing a field.
  // The raw override travels alongside so a UI can tell the two apart.
  describe('GET /api/accounts/:id/coverage exposes the raw override', () => {
    async function getCoverage(accountId: string) {
      const res = await app.request(`/api/accounts/${accountId}/coverage`, {
        headers: { Cookie: cookie },
      })
      return await res.json() as { config: Record<string, unknown>; override: Record<string, unknown> }
    }

    it('is empty when nothing has been pinned', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      expect((await getCoverage(acct.id)).override).toEqual({})
    })

    it('carries only the pinned fields, not the whole merged config', async () => {
      const acct = await createAccount(userId, 'liabilities:visa')
      await patchConfig(cookie, acct.id, { exportMode: 'cycle', cycleDay: 25 })

      const { config, override } = await getCoverage(acct.id)

      expect(override).toEqual({ exportMode: 'cycle', cycleDay: 25 })
      // releaseLag and tracked are still defaults, so they must not appear as pins.
      expect(config).toMatchObject({ exportMode: 'cycle', cycleDay: 25, releaseLag: 0, tracked: true })
    })

    it('distinguishes an inferred value from a pinned one of the same number', async () => {
      const inferred = await createAccount(userId, 'liabilities:inferred')
      const pinned = await createAccount(userId, 'liabilities:pinned')
      await seedMonthlyStatements(cookie, inferred.id)
      await patchConfig(cookie, pinned.id, { exportMode: 'cycle', cycleDay: 25 })

      const a = await getCoverage(inferred.id)
      const b = await getCoverage(pinned.id)

      // Same effective cycle day, opposite provenance — indistinguishable without `override`.
      expect(a.config.cycleDay).toBe(25)
      expect(b.config.cycleDay).toBe(25)
      expect(a.override).toEqual({})
      expect(b.override).toEqual({ exportMode: 'cycle', cycleDay: 25 })
    })

    it('carries what inference would say, even while a pin is overriding it', async () => {
      const acct = await createAccount(userId, 'liabilities:visa')
      await seedMonthlyStatements(cookie, acct.id)
      await patchConfig(cookie, acct.id, { cycleDay: 3 })

      const res = await app.request(`/api/accounts/${acct.id}/coverage`, {
        headers: { Cookie: cookie },
      })
      const body = await res.json() as {
        config: Record<string, unknown>
        inferred: Record<string, unknown> | null
      }

      // Without this, an editor offering "back to automatic" cannot say what automatic means:
      // `config` is post-merge and now reads 3, and inference's own answer is lost.
      expect(body.config.cycleDay).toBe(3)
      expect(body.inferred).toMatchObject({ exportMode: 'cycle', cycleDay: 25 })
    })

    it('is null when there is not enough history to infer anything', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await app.request(`/api/accounts/${acct.id}/coverage`, {
        headers: { Cookie: cookie },
      })
      expect((await res.json()).inferred).toBeNull()
    })

    it('drops a field from the override once it is cleared back to automatic', async () => {
      const acct = await createAccount(userId, 'liabilities:visa')
      await patchConfig(cookie, acct.id, { exportMode: 'cycle', cycleDay: 25, releaseLag: 3 })

      await patchConfig(cookie, acct.id, { releaseLag: null })

      expect((await getCoverage(acct.id)).override).toEqual({ exportMode: 'cycle', cycleDay: 25 })
    })

    it("does not leak another user's override", async () => {
      const acct = await createAccount(userId, 'liabilities:visa')
      await patchConfig(cookie, acct.id, { exportMode: 'cycle', cycleDay: 25 })

      const otherCookie = await createTestUser('other@example.com')
      const otherUserId = await userIdFor(otherCookie)
      const otherAcct = await createAccount(otherUserId, 'liabilities:visa')

      const res = await app.request(`/api/accounts/${otherAcct.id}/coverage`, {
        headers: { Cookie: otherCookie },
      })
      expect((await res.json()).override).toEqual({})
    })
  })

  describe('effectiveConfig', () => {
    it('is the default for an account with no history and no override', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      expect(await effectiveConfig(userId, acct.id)).toEqual({
        exportMode: 'range', cycleDay: null, releaseLag: 0, tracked: true,
      })
    })

    it('picks up an inferred cycle from the account\'s own statements', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      await seedMonthlyStatements(cookie, visa.id)

      expect(await effectiveConfig(userId, visa.id)).toMatchObject({ exportMode: 'cycle', cycleDay: 25 })
    })

    it('does not infer from another account\'s statements', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      const chequing = await createAccount(userId, 'assets:chequing')
      await seedMonthlyStatements(cookie, visa.id)

      expect(await effectiveConfig(userId, chequing.id)).toMatchObject({ exportMode: 'range' })
    })

    it('stops inferring once the statements are withdrawn', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      const first = await (await postCoverage(cookie, visa.id, '2025-04-26', '2025-05-25')).json()
      await postCoverage(cookie, visa.id, '2025-05-26', '2025-06-25')
      await postCoverage(cookie, visa.id, '2025-06-26', '2025-07-25')

      expect(await effectiveConfig(userId, visa.id)).toMatchObject({ cycleDay: 25 })

      await app.request(`/api/coverage/${first.id}`, { method: 'DELETE', headers: { Cookie: cookie } })

      // Down to two intervals — back below the threshold inference will act on.
      expect(await effectiveConfig(userId, visa.id)).toMatchObject({ exportMode: 'range', cycleDay: null })
    })

    it('lets a stored override beat inference', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      await seedMonthlyStatements(cookie, visa.id)
      await patchConfig(cookie, visa.id, { cycleDay: 18 })

      expect(await effectiveConfig(userId, visa.id)).toMatchObject({ exportMode: 'cycle', cycleDay: 18 })
    })
  })

  describe('readCatchUpOverrides', () => {
    it('is empty when the user has no settings row', async () => {
      expect(await readCatchUpOverrides(userId)).toEqual({})
    })

    // The blob is hand-editable via Drizzle Studio and the settings PATCH, so garbage in it
    // must not become garbage config.
    it('drops values it does not recognise', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await db.update(userSettings).set({
        preferences: {
          catchUp: {
            [acct.id]: { exportMode: 'telepathy', cycleDay: 99, releaseLag: -4, tracked: 'yes' },
          },
        },
      }).where(eq(userSettings.userId, userId))

      expect(await readCatchUpOverrides(userId)).toEqual({ [acct.id]: {} })
      expect(await effectiveConfig(userId, acct.id)).toEqual({
        exportMode: 'range', cycleDay: null, releaseLag: 0, tracked: true,
      })
    })

    it('ignores a catchUp key that is not an object', async () => {
      await db.update(userSettings).set({ preferences: { catchUp: 'nonsense' } }).where(eq(userSettings.userId, userId))

      expect(await readCatchUpOverrides(userId)).toEqual({})
    })
  })

  describe('PATCH /api/coverage/config/:accountId', () => {
    it('pins a cycle day by hand', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')

      const res = await patchConfig(cookie, visa.id, { exportMode: 'cycle', cycleDay: 25 })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.config).toMatchObject({ exportMode: 'cycle', cycleDay: 25, releaseLag: 0 })
      expect(body.override).toEqual({ exportMode: 'cycle', cycleDay: 25 })
      expect(body.horizon).toBeString()
      expect(body.nextHorizon).toBeString()
    })

    it('returns a null nextHorizon for a range account', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const body = await (await patchConfig(cookie, acct.id, { exportMode: 'range' })).json()

      expect(body.nextHorizon).toBeNull()
      expect(body.horizon).toBe(new Date().toISOString().substring(0, 10))
    })

    it('accumulates fields across separate patches', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      await patchConfig(cookie, visa.id, { exportMode: 'cycle', cycleDay: 25 })

      const body = await (await patchConfig(cookie, visa.id, { releaseLag: 3 })).json()

      expect(body.override).toEqual({ exportMode: 'cycle', cycleDay: 25, releaseLag: 3 })
    })

    it('untracks an account', async () => {
      const acct = await createAccount(userId, 'assets:old-thing')

      const body = await (await patchConfig(cookie, acct.id, { tracked: false })).json()

      expect(body.config.tracked).toBe(false)
      expect(await effectiveConfig(userId, acct.id)).toMatchObject({ tracked: false })
    })

    it('clears one override with null and hands the field back to inference', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      await seedMonthlyStatements(cookie, visa.id)
      await patchConfig(cookie, visa.id, { cycleDay: 18 })
      expect(await effectiveConfig(userId, visa.id)).toMatchObject({ cycleDay: 18 })

      const body = await (await patchConfig(cookie, visa.id, { cycleDay: null })).json()

      expect(body.config.cycleDay).toBe(25)
      expect(body.override).toEqual({})
    })

    // Clearing the last pinned field should leave no trace, not an empty object per account.
    it('drops the account key entirely once nothing is pinned', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await patchConfig(cookie, acct.id, { tracked: false })
      expect((await storedPreferences(userId))!.catchUp).toHaveProperty(acct.id)

      await patchConfig(cookie, acct.id, { tracked: null })

      expect((await storedPreferences(userId))!.catchUp).not.toHaveProperty(acct.id)
    })

    // The settings route merges preferences shallowly, which would wipe every other account's
    // config. This route must not.
    it('leaves other accounts\' config untouched', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      const chequing = await createAccount(userId, 'assets:chequing')

      await patchConfig(cookie, visa.id, { exportMode: 'cycle', cycleDay: 25 })
      await patchConfig(cookie, chequing.id, { tracked: false })

      const overrides = await readCatchUpOverrides(userId)
      expect(overrides[visa.id]).toEqual({ exportMode: 'cycle', cycleDay: 25 })
      expect(overrides[chequing.id]).toEqual({ tracked: false })
    })

    it('leaves unrelated preference keys untouched', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await app.request('/api/user-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ preferences: { hiddenAccountIds: ['abc'], theme: 'graphite' } }),
      })

      await patchConfig(cookie, acct.id, { tracked: false })

      const preferences = await storedPreferences(userId)
      expect(preferences!.hiddenAccountIds).toEqual(['abc'])
      expect(preferences!.theme).toBe('graphite')
      expect(preferences!.catchUp).toHaveProperty(acct.id)
    })

    // Sign-up seeds a settings row, so this only fires for users who predate that hook —
    // the same case GET /api/user-settings already defends against.
    it('creates the settings row when the user has none', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await db.delete(userSettings).where(eq(userSettings.userId, userId))
      expect(await storedPreferences(userId)).toBeUndefined()

      await patchConfig(cookie, acct.id, { tracked: false })

      expect((await storedPreferences(userId))!.catchUp).toEqual({ [acct.id]: { tracked: false } })
    })

    // horizon() defends against this by falling back to today, but silently accepting it would
    // leave the user with a 'cycle' account behaving exactly like a 'range' one.
    it('rejects a cycle account with no cycle day to compute closes from', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await patchConfig(cookie, acct.id, { exportMode: 'cycle' })

      expect(res.status).toBe(400)
    })

    it('accepts a bare cycle switch when the cycle day is already inferred', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      await seedMonthlyStatements(cookie, visa.id)

      const res = await patchConfig(cookie, visa.id, { exportMode: 'cycle' })

      expect(res.status).toBe(200)
      expect((await res.json()).config.cycleDay).toBe(25)
    })

    it('rejects an unknown export mode', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      expect((await patchConfig(cookie, acct.id, { exportMode: 'telepathy' })).status).toBe(400)
    })

    it('rejects an out-of-range cycle day', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      expect((await patchConfig(cookie, acct.id, { cycleDay: 0 })).status).toBe(400)
      expect((await patchConfig(cookie, acct.id, { cycleDay: 32 })).status).toBe(400)
      expect((await patchConfig(cookie, acct.id, { cycleDay: 12.5 })).status).toBe(400)
    })

    it('rejects a negative release lag', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      expect((await patchConfig(cookie, acct.id, { releaseLag: -1 })).status).toBe(400)
    })

    it('rejects a non-boolean tracked', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      expect((await patchConfig(cookie, acct.id, { tracked: 'yes' })).status).toBe(400)
    })

    it('rejects a body with nothing recognisable in it', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      expect((await patchConfig(cookie, acct.id, { colour: 'blue' })).status).toBe(400)
    })

    it('refuses to configure another user\'s account', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const theirAccount = await createAccount(await userIdFor(otherCookie), 'assets:theirs')

      const res = await patchConfig(cookie, theirAccount.id, { tracked: false })

      expect(res.status).toBe(404)
      expect(await storedPreferences(userId)).not.toHaveProperty('catchUp')
    })

    it('returns 404 rather than 500 for a malformed account id', async () => {
      expect((await patchConfig(cookie, 'not-a-uuid', { tracked: false })).status).toBe(404)
    })

    it('requires authentication', async () => {
      const res = await app.request('/api/coverage/config/00000000-0000-4000-8000-000000000000', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracked: false }),
      })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/accounts/:id/coverage', () => {
    it('reports the horizon alongside the coverage', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      await seedMonthlyStatements(cookie, visa.id)

      const body = await (await app.request(`/api/accounts/${visa.id}/coverage`, { headers: { Cookie: cookie } })).json()

      expect(body.config).toMatchObject({ exportMode: 'cycle', cycleDay: 25 })
      // Whatever today is, a cycle-25 account's horizon is a 25th at or before it.
      expect(body.horizon.endsWith('-25')).toBe(true)
      expect(body.horizon <= new Date().toISOString().substring(0, 10)).toBe(true)
      expect(body.nextHorizon > body.horizon).toBe(true)
    })

    it('reports today as the horizon for a range account', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const body = await (await app.request(`/api/accounts/${acct.id}/coverage`, { headers: { Cookie: cookie } })).json()

      expect(body.horizon).toBe(new Date().toISOString().substring(0, 10))
      expect(body.nextHorizon).toBeNull()
      expect(body.config).toEqual({ exportMode: 'range', cycleDay: null, releaseLag: 0, tracked: true })
    })
  })
})
