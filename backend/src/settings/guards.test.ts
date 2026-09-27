import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

// Checks on PATCH /api/user-settings that no test caught when removed, before the move into
// `settings-service`.

const json = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' })

const patch = (cookie: string, body: object) =>
  request('/api/user-settings', {
    method: 'PATCH',
    headers: json(cookie),
    body: JSON.stringify(body),
  })

describe('PATCH /api/user-settings', () => {
  let mine: string

  beforeEach(async () => {
    await clearDatabase()
    mine = await createTestUser()
  })

  it("refuses another user's account as a default, naming the field", async () => {
    const theirs = await createTestUser('other@example.com')
    const res = await request('/api/accounts', {
      method: 'POST',
      headers: json(theirs),
      body: JSON.stringify({ path: 'expenses:theirs' }),
    })
    const theirAccount = ((await res.json()) as { id: string }).id

    for (const field of [
      'defaultOffsetAccountId',
      'defaultConversionAccountId',
      'defaultAdjustmentsAccountId',
    ]) {
      const refused = await patch(mine, { [field]: theirAccount })
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({
        error: 'SETTING_ACCOUNT_NOT_FOUND',
        detail: { field },
      })
    }
  })

  it('refuses a currency it does not support, and stores nothing', async () => {
    const before = await (await request('/api/user-settings', { headers: { Cookie: mine } })).json()
    const refused = await patch(mine, { preferredCurrency: 'XYZ', defaultAssetsRootPath: 'money' })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      error: 'UNSUPPORTED_CURRENCY',
      detail: { currency: 'XYZ' },
    })
    const after = await (await request('/api/user-settings', { headers: { Cookie: mine } })).json()
    expect(after).toEqual(before)
  })
})
