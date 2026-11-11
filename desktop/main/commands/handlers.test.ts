import { describe, expect, it } from 'vitest'
import type { Handlers } from './handlers'

// `bun run check` compiles these: each `@ts-expect-error` fails it if the line ever compiles.
describe('a handler map', () => {
  it('missing a command is a compile error for Handlers', () => {
    const partial = {} as Omit<Handlers, 'clipboard.copy'>
    // @ts-expect-error: `clipboard.copy` has no handler.
    const handlers: Handlers = partial
    expect(handlers).toBe(partial)
  })
})
