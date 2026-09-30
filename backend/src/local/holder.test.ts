import { afterEach, describe, expect, it } from 'bun:test'
import type { Server } from 'bun'
import { holderAnswers } from './holder'
import { launchTokenRedeemer } from './launch-token'

const servers: Server<undefined>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

/** An instance holding `key`, answering the one question the way the local edge does. */
function instance(key: string, delayMs = 0) {
  const redeem = launchTokenRedeemer(key)
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (req) => {
      await Bun.sleep(delayMs)
      const { token } = (await req.json()) as { token: string }
      return new Response(null, { status: redeem(token) ? 204 : 401 })
    },
  })
  servers.push(server)
  return server.port ?? 0
}

describe('holderAnswers', () => {
  it('is true for an instance holding the key', async () => {
    expect(await holderAnswers({ port: instance('k'), launchKey: 'k' })).toBe(true)
  })

  it('is false for something on the port that does not hold the key', async () => {
    expect(await holderAnswers({ port: instance('someone else'), launchKey: 'k' })).toBe(false)
  })

  it('is false, at once, when nothing is listening', async () => {
    const port = instance('k')
    for (const server of servers.splice(0)) server.stop(true)
    const started = Date.now()
    expect(await holderAnswers({ port, launchKey: 'k' })).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('is false when the answer takes longer than it was given', async () => {
    const port = instance('k', 500)
    expect(await holderAnswers({ port, launchKey: 'k' }, 100)).toBe(false)
    expect(await holderAnswers({ port, launchKey: 'k' }, 2000)).toBe(true)
  })
})
