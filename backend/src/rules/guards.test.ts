import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

// Another user's rule is out of reach on every route that names one by id. Before the move
// into `rule-service`, dropping the owner from the WHERE clause failed no test.

const json = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' })

describe("another user's rule", () => {
  let mine: string
  let theirs: string
  let ruleId: string

  beforeEach(async () => {
    await clearDatabase()
    mine = await createTestUser()
    theirs = await createTestUser('other@example.com')
    const account = await request('/api/accounts', {
      method: 'POST',
      headers: json(theirs),
      body: JSON.stringify({ path: 'expenses:coffee' }),
    })
    const accountId = ((await account.json()) as { id: string }).id
    const rule = await request('/api/rules', {
      method: 'POST',
      headers: json(theirs),
      body: JSON.stringify({ pattern: 'Blue Bottle', accountId }),
    })
    expect(rule.status).toBe(201)
    ruleId = ((await rule.json()) as { id: string }).id
  })

  const theirRules = async () =>
    (await (await request('/api/rules', { headers: { Cookie: theirs } })).json()) as {
      id: string
      pattern: string
      status: string
    }[]

  it('cannot be changed, approved, denied or revived', async () => {
    const patch = await request(`/api/rules/${ruleId}`, {
      method: 'PATCH',
      headers: json(mine),
      body: JSON.stringify({ pattern: 'hijacked' }),
    })
    expect(patch.status).toBe(404)
    expect(await patch.json()).toEqual({ error: 'RULE_NOT_FOUND' })

    for (const move of ['approve', 'deny', 'revive']) {
      const res = await request(`/api/rules/${ruleId}/${move}`, {
        method: 'POST',
        headers: json(mine),
      })
      expect(res.status).toBe(404)
    }
    expect(await theirRules()).toMatchObject([
      { id: ruleId, pattern: 'Blue Bottle', status: 'active' },
    ])
  })

  it('cannot be deleted', async () => {
    const res = await request(`/api/rules/${ruleId}`, { method: 'DELETE', headers: json(mine) })
    expect(res.status).toBe(204)
    expect((await theirRules()).map((r) => r.id)).toEqual([ruleId])
  })
})
