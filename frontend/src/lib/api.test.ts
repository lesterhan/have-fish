import { afterEach, describe, expect, it } from 'bun:test'
import { ImportRefused, ImportUnanswered, importCommit } from './api'

describe('importCommit', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function answering(response: () => Response) {
    globalThis.fetch = Object.assign(async () => response(), {
      preconnect: realFetch.preconnect,
    })
  }

  const request = {
    accountId: 'a',
    defaultCurrency: 'CAD',
    transactions: [],
  }

  it('returns the counts when the batch was written', async () => {
    const counts = { created: 3, skipped: 1, fishPieExpenses: 0 }
    answering(() => Response.json(counts, { status: 201 }))
    expect(await importCommit(request)).toEqual(counts)
  })

  // #533: the refusal came back as the result, and the page celebrated an empty import.
  it('throws a refusal with the body the API answered, rather than returning it', async () => {
    const refusal = { error: 'AMOUNT_INVALID', detail: { amount: '1,234.56', index: 7 } }
    answering(() => Response.json(refusal, { status: 400 }))
    const thrown = await importCommit(request).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(ImportRefused)
    expect((thrown as ImportRefused).body).toEqual(refusal)
  })

  // #535: a proxy's error page is not a refusal. The batch may be in, so the page must ask
  // rather than say it failed.
  it('throws an unanswered commit for a body the API did not write', async () => {
    for (const [body, status] of [
      ['<html>Bad Gateway</html>', 502],
      ['<html>Gateway Timeout</html>', 504],
      ['Internal Server Error', 500],
      ['{"message":"upstream reset"}', 503],
    ] as const) {
      answering(() => new Response(body, { status }))
      const thrown = await importCommit(request).catch((e: unknown) => e)
      expect(thrown).toBeInstanceOf(ImportUnanswered)
      expect((thrown as ImportUnanswered).status).toBe(status)
    }
  })

  it('still reads a coded 500 as the API refusing', async () => {
    answering(() => Response.json({ error: 'INTERNAL' }, { status: 500 }))
    expect(await importCommit(request).catch((e: unknown) => e)).toBeInstanceOf(ImportRefused)
  })
})
