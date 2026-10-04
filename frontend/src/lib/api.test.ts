import { afterEach, describe, expect, it } from 'bun:test'
import { ImportRefused, importCommit } from './api'

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

  it('throws a refusal whose body is not JSON, with no body to read', async () => {
    answering(() => new Response('<html>Bad Gateway</html>', { status: 502 }))
    const thrown = await importCommit(request).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(ImportRefused)
    expect((thrown as ImportRefused).body).toBeNull()
  })
})
