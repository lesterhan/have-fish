import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('user-settings', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET seeds a row with the default income root path', async () => {
    const res = await app.request('/api/user-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as { defaultIncomeRootPath: string }
    expect(body.defaultIncomeRootPath).toBe('income')
  })

  it('PATCH updates the income root path', async () => {
    const res = await app.request('/api/user-settings', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultIncomeRootPath: 'earnings' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { defaultIncomeRootPath: string }
    expect(body.defaultIncomeRootPath).toBe('earnings')
  })

  it('PATCH rejects an empty income root path', async () => {
    const res = await app.request('/api/user-settings', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultIncomeRootPath: '   ' }),
    })
    expect(res.status).toBe(400)
  })
})
