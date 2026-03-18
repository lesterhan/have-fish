import { describe, it, expect, beforeEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, '../import/fixtures', name), 'utf-8')

describe('POST /api/import/preview', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('parses a WealthSimple CSV and returns transactions', async () => {
    const form = new FormData()
    form.append('file', new Blob([fixture('ws-sample.csv')], { type: 'text/csv' }), 'ws-sample.csv')
    form.append('accountId', 'some-account-id')
    form.append('defaultCurrency', 'CAD')

    const res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transactions).toBeArray()
    expect(body.transactions.length).toBeGreaterThan(0)
    expect(body.errors).toBeArray()
  })
})
