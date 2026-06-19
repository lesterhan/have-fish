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

  // Helper: the YYYY-MM-DD string for `daysAgo` days before today (UTC).
  function dateDaysAgo(daysAgo: number): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - daysAgo)
    return d.toISOString().substring(0, 10)
  }

  describe('GET /api/fx-rates/as-of', () => {
    it("returns yesterday's rate with asOfDate when it is published", async () => {
      const yesterday = dateDaysAgo(1)
      const fetchSpy = spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ rates: { CAD: 1.4732 } }), { status: 200 }),
      )

      const res = await app.request('/api/fx-rates/as-of?from=EUR&to=CAD', {
        headers: { Cookie: cookie },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { from: string; to: string; rate: string; asOfDate: string }
      expect(body.from).toBe('EUR')
      expect(body.to).toBe('CAD')
      expect(parseFloat(body.rate)).toBeCloseTo(1.4732)
      expect(body.asOfDate).toBe(yesterday)
      // First try (yesterday) succeeds — no walk-back.
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      fetchSpy.mockRestore()
    })

    it('walks back over a no-data day to the last published day', async () => {
      const twoDaysAgo = dateDaysAgo(2)
      // Yesterday: no data (e.g. weekend/holiday). Two days ago: published.
      const fetchSpy = spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input)
        if (url.includes(twoDaysAgo)) {
          return new Response(JSON.stringify({ rates: { CAD: 1.5 } }), { status: 200 })
        }
        return new Response(JSON.stringify({ rates: {} }), { status: 200 })
      })

      const res = await app.request('/api/fx-rates/as-of?from=EUR&to=CAD', {
        headers: { Cookie: cookie },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { rate: string; asOfDate: string }
      expect(parseFloat(body.rate)).toBeCloseTo(1.5)
      expect(body.asOfDate).toBe(twoDaysAgo)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      fetchSpy.mockRestore()
    })

    it('returns 404 when no rate is published in the lookback window', async () => {
      // Fresh Response per call — a single Response body can only be read once,
      // and the helper walks back several days (reading each).
      const fetchSpy = spyOn(global, 'fetch').mockImplementation(
        async () => new Response(JSON.stringify({ rates: {} }), { status: 200 }),
      )

      const res = await app.request('/api/fx-rates/as-of?from=EUR&to=CAD', {
        headers: { Cookie: cookie },
      })

      expect(res.status).toBe(404)
      fetchSpy.mockRestore()
    })

    it('returns 400 when from/to are missing', async () => {
      const res = await app.request('/api/fx-rates/as-of?from=EUR', {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 for an unsupported currency', async () => {
      const res = await app.request('/api/fx-rates/as-of?from=EUR&to=ZZZ', {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(400)
    })
  })
})
