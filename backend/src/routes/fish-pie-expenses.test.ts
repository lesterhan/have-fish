import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('fish-pie expenses', () => {
  let cookie: string
  let groupId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    const res = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip' }),
    })
    groupId = (await res.json() as any).id
  })

  it('POST creates expense and splits sum to expense amount', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '90.00', currency: 'CAD', date: '2026-04-28' }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any
    expect(expense.description).toBe('Dinner')
    expect(expense.splits).toHaveLength(1)
    const splitTotal = expense.splits.reduce((s: number, sp: any) => s + parseFloat(sp.amount), 0)
    expect(splitTotal.toFixed(2)).toBe('90.00')
  })
})
