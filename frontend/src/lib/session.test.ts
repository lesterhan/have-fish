import { describe, it, expect } from 'bun:test'
import { toUser } from './session'

// The caching is `once`, tested in `once.test.ts`. What is left here is the shape of a
// Better Auth get-session response, which is pure and needs no client.
describe('toUser', () => {
  const USER = { id: 'u1', email: 'a@b.c' }

  it('finds the user in a signed-in response', () => {
    expect(toUser({ data: { user: USER } })).toEqual(USER)
  })

  it('reads a signed-out response as no user', () => {
    expect(toUser({ data: null })).toBeNull()
  })

  // Better Auth answers a request with no cookie by omitting `data` rather than sending
  // null, so both shapes have to mean the same thing.
  it('reads a response with no data at all as no user', () => {
    expect(toUser({})).toBeNull()
  })

  it('reads an empty response as no user', () => {
    expect(toUser(null)).toBeNull()
    expect(toUser(undefined)).toBeNull()
  })

  it('reads a response carrying no user as no user', () => {
    expect(toUser({ data: {} })).toBeNull()
  })
})
