import { describe, it, expect, beforeEach, spyOn } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('fx-rates', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    // createTestUser calls fetch internally (Better Auth) — spy is set up per-test
    // AFTER this so auth calls are never counted in fetch assertions.
    cookie = await createTestUser()
  })

  it('GET /api/fx-rates fetches from frankfurter.app and caches the result', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ rates: { CAD: 1.473200 } }), { status: 200 }),
    )

    const res = await app.request('/api/fx-rates?date=2024-01-15&from=EUR&to=CAD', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { date: string; from: string; to: string; rate: string }
    expect(body.date).toBe('2024-01-15')
    expect(body.from).toBe('EUR')
    expect(body.to).toBe('CAD')
    expect(parseFloat(body.rate)).toBeGreaterThan(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second request for the same pair should hit the DB cache — no network call
    fetchSpy.mockClear()
    const res2 = await app.request('/api/fx-rates?date=2024-01-15&from=EUR&to=CAD', {
      headers: { Cookie: cookie },
    })
    expect(res2.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('GET /api/fx-rates returns 404 when the API returns no rate for the date', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ rates: {} }), { status: 200 }),
    )

    const res = await app.request('/api/fx-rates?date=2024-01-13&from=EUR&to=CAD', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
    fetchSpy.mockRestore()
  })

  it('GET /api/fx-rates returns 404 for a future date without hitting the network', async () => {
    const fetchSpy = spyOn(global, 'fetch')

    const res = await app.request('/api/fx-rates?date=2099-01-01&from=EUR&to=CAD', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('GET /api/fx-rates returns 400 when query params are missing', async () => {
    const res = await app.request('/api/fx-rates?date=2024-01-15&from=EUR', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(400)
  })
})
