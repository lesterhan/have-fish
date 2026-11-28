// What the app's one call out says: the URL a run asks, the query it sends, and every answer it
// refuses rather than passing on.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { failure } from '@have-fish/core/outcome'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { RATES_URL, ratesFrom, ratesUrlFor } from './rate-source'

/** One currency's rates into another, over a span of days. */
const JAPAN = { from: 'JPY', to: 'CAD', start: '2026-11-12', end: '2026-11-26' }

/** One entry of an answer, for the JAPAN pair, its rate as given and never in quotes. */
const entry = (date: string, rate: string) =>
  `{"date":"${date}","base":"JPY","quote":"CAD","rate":${rate}}`

/** A server on this machine answering `status` and `body`, or never when `body` is null. */
async function aService(status: number, body: string | null) {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    if (body === null) return
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(body)
  })
  let closed = false
  /** Stops it answering; anything still connected goes with it. */
  const close = async () => {
    if (closed) return
    closed = true
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(close)
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/v2/rates`, requests, close }
}

describe('asking the service', () => {
  test('asks once, for the pair, the days and the ECB’s rates', async () => {
    const service = await aService(200, '[]')

    await ratesFrom(service.url).rates(JAPAN)

    expect(service.requests).toHaveLength(1)
    const asked = new URL(service.requests[0] ?? '', service.url)
    expect(asked.pathname).toBe('/v2/rates')
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      base: 'JPY',
      quotes: 'CAD',
      from: '2026-11-12',
      to: '2026-11-26',
      providers: 'ecb',
    })
  })

  test('answers each day the service published, and its rate as text', async () => {
    const service = await aService(200, `[${entry('2026-11-20', '0.0090181')}]`)

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual({
      ok: true,
      value: [{ date: '2026-11-20', rate: '0.0090181' }],
    })
  })

  test('keeps a rate’s trailing zero, where a float drops it', async () => {
    const service = await aService(200, `[${entry('2026-11-20', '0.0089110')}]`)

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual({
      ok: true,
      value: [{ date: '2026-11-20', rate: '0.0089110' }],
    })
  })

  test('keeps a tiny rate’s digits, where a float’s text is an exponent', async () => {
    const service = await aService(200, `[${entry('2026-11-20', '0.00000078')}]`)

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual({
      ok: true,
      value: [{ date: '2026-11-20', rate: '0.00000078' }],
    })
  })

  test('a currency the ECB does not quote answers no rates', async () => {
    const service = await aService(422, '{"status":422,"message":"invalid currency: NTD"}')

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual({ ok: true, value: [] })
  })

  test('an empty answer is no rates', async () => {
    const service = await aService(200, '[]')

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual({ ok: true, value: [] })
  })

  test('a server error is a refusal', async () => {
    const service = await aService(500, '')

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_NOT_FETCHED'))
  })

  test('a 404 is a refusal, where only a 422 is no rates', async () => {
    const service = await aService(404, '{"status":404,"message":"not found"}')

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_NOT_FETCHED'))
  })

  test('a service that is gone is a refusal, and the answer settles', async () => {
    const service = await aService(200, '[]')
    await service.close()

    await expect(ratesFrom(service.url).rates(JAPAN)).resolves.toEqual(failure('RATES_NOT_FETCHED'))
  })

  test('a service that never answers is a refusal, once the time is up', async () => {
    const service = await aService(200, null)

    expect(await ratesFrom(service.url, 50).rates(JAPAN)).toEqual(failure('RATES_NOT_FETCHED'))
  })

  test('an answer that is not JSON is a refusal', async () => {
    const service = await aService(200, '<html></html>')

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('an answer of another shape is a refusal', async () => {
    const service = await aService(200, '{"rates":{"CAD":0.0090181}}')

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('a rate in an exponent is a refusal, where readRate alone would take it', async () => {
    const service = await aService(200, `[${entry('2026-11-20', '7.8e-7')}]`)

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('a rate below what a rate can be is a refusal', async () => {
    const service = await aService(200, `[${entry('2026-11-20', '0')}]`)

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('an answer for another pair is a refusal', async () => {
    const service = await aService(
      200,
      '[{"date":"2026-11-20","base":"GBP","quote":"CAD","rate":1.71}]',
    )

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('an answer for another quote is a refusal', async () => {
    const service = await aService(
      200,
      '[{"date":"2026-11-20","base":"JPY","quote":"EUR","rate":0.0055}]',
    )

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('a failed request logs nothing, whatever the failure', async () => {
    const spies = [
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
    ]
    onTestFinished(() => {
      for (const spy of spies) spy.mockRestore()
    })
    const gone = await aService(200, '[]')
    const failed = await aService(500, '')
    const slow = await aService(200, null)
    await gone.close()

    await ratesFrom(gone.url).rates(JAPAN)
    await ratesFrom(failed.url).rates(JAPAN)
    await ratesFrom(slow.url, 50).rates(JAPAN)
    await ratesFrom('not a url').rates(JAPAN)

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  test('a day the calendar lacks in the answer is a refusal', async () => {
    const service = await aService(200, `[${entry('2026-02-30', '0.0091')}]`)

    expect(await ratesFrom(service.url).rates(JAPAN)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('a bad address is a refusal, and the answer settles', async () => {
    await expect(ratesFrom('not a url').rates(JAPAN)).resolves.toEqual(failure('RATES_NOT_FETCHED'))
  })
})

describe('the last day it published', () => {
  const PAIR = { from: 'JPY', to: 'CAD' }

  test('asks the coverage for the pair and the ECB’s rates, and nothing else', async () => {
    const service = await aService(200, '{"end_date":"2022-02-28"}')

    await ratesFrom(service.url).lastDay(PAIR)

    expect(service.requests).toHaveLength(1)
    const asked = new URL(service.requests[0] ?? '', service.url)
    expect(asked.pathname).toBe('/v2/coverage')
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      base: 'JPY',
      quotes: 'CAD',
      providers: 'ecb',
    })
  })

  test('answers the last day the coverage names', async () => {
    const service = await aService(200, '{"end_date":"2022-02-28"}')

    expect(await ratesFrom(service.url).lastDay(PAIR)).toEqual({
      ok: true,
      value: '2022-02-28',
    })
  })

  test.each([
    [404, '{"status":404,"message":"not found"}'],
    [422, '{"status":422,"message":"invalid currency: NTD"}'],
  ])('a %s on the coverage is no last day', async (status, body) => {
    const service = await aService(status, body)

    expect(await ratesFrom(service.url).lastDay(PAIR)).toEqual({ ok: true, value: null })
  })

  test('a server error on the coverage is a refusal', async () => {
    const service = await aService(500, '')

    expect(await ratesFrom(service.url).lastDay(PAIR)).toEqual(failure('RATES_NOT_FETCHED'))
  })

  test('a service that is gone is a refusal on the coverage too, and the answer settles', async () => {
    const service = await aService(200, '{"end_date":"2022-02-28"}')
    await service.close()

    await expect(ratesFrom(service.url).lastDay(PAIR)).resolves.toEqual(
      failure('RATES_NOT_FETCHED'),
    )
  })

  test('a coverage that never answers is a refusal, once the time is up', async () => {
    const service = await aService(200, null)

    expect(await ratesFrom(service.url, 50).lastDay(PAIR)).toEqual(failure('RATES_NOT_FETCHED'))
  })

  test('an end_date the calendar lacks is a refusal', async () => {
    const service = await aService(200, '{"end_date":"2022-02-30"}')

    expect(await ratesFrom(service.url).lastDay(PAIR)).toEqual(failure('RATES_UNREADABLE'))
  })

  test('a failed coverage logs nothing, whatever the failure', async () => {
    const spies = [
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
    ]
    onTestFinished(() => {
      for (const spy of spies) spy.mockRestore()
    })
    const gone = await aService(200, '{"end_date":"2022-02-28"}')
    const failed = await aService(500, '')
    const slow = await aService(200, null)
    await gone.close()

    await ratesFrom(gone.url).lastDay(PAIR)
    await ratesFrom(failed.url).lastDay(PAIR)
    await ratesFrom(slow.url, 50).lastDay(PAIR)
    await ratesFrom('not a url').lastDay(PAIR)

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('the service a run asks', () => {
  test('the published rates come from Frankfurter’s v2, over the ECB’s', () => {
    expect(RATES_URL).toBe('https://api.frankfurter.dev/v2/rates')
  })

  test('a development run may point at another service', () => {
    expect(ratesUrlFor(false, { HAVE_FISH_RATES_URL: 'http://127.0.0.1:9/v2/rates' })).toBe(
      'http://127.0.0.1:9/v2/rates',
    )
  })

  test('a packaged app asks only the published rates’ address', () => {
    expect(ratesUrlFor(true, { HAVE_FISH_RATES_URL: 'http://127.0.0.1:9/v2/rates' })).toBe(
      RATES_URL,
    )
  })

  test('no variable set is the published rates’ address', () => {
    expect(ratesUrlFor(false, {})).toBe(RATES_URL)
  })

  test('an empty variable is no address, so the published rates’ one', () => {
    expect(ratesUrlFor(false, { HAVE_FISH_RATES_URL: '' })).toBe(RATES_URL)
  })
})
