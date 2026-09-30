import { afterEach, describe, expect, it } from 'bun:test'
import type { Server } from 'bun'
import { askToQuit, holderAnswers } from './holder'
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

describe('askToQuit', () => {
  /** An instance that hands out a session for a good token, and quits for that session. */
  function quittable(key: string) {
    const redeem = launchTokenRedeemer(key)
    const quits: string[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        const path = new URL(req.url).pathname
        if (path === '/api/local/session') {
          const { token } = (await req.json()) as { token: string }
          if (!redeem(token)) return new Response(null, { status: 401 })
          return new Response(null, { status: 204, headers: { 'Set-Cookie': 's=1; HttpOnly' } })
        }
        if (path === '/api/local/quit' && req.headers.get('cookie') === 's=1') {
          quits.push(path)
          return new Response(null, { status: 202 })
        }
        return new Response(null, { status: 401 })
      },
    })
    servers.push(server)
    return { port: server.port ?? 0, quits }
  }

  it('signs in with the key and asks it to quit', async () => {
    const running = quittable('k')
    expect(await askToQuit({ port: running.port, launchKey: 'k' })).toBe(true)
    expect(running.quits).toEqual(['/api/local/quit'])
  })

  it('asks nothing of an instance whose key it does not have', async () => {
    const running = quittable('someone else')
    expect(await askToQuit({ port: running.port, launchKey: 'k' })).toBe(false)
    expect(running.quits).toEqual([])
  })

  it('is false when nothing is listening', async () => {
    const { port } = quittable('k')
    for (const server of servers.splice(0)) server.stop(true)
    expect(await askToQuit({ port, launchKey: 'k' })).toBe(false)
  })
})
