import { describe, expect, it } from 'vitest'
import type { spendInputs } from '../../shared/commands'
import type { Handlers, HandlersFor } from './handlers'

// `bun run check` compiles these: each `@ts-expect-error` fails it if the line ever compiles.
describe('a handler map', () => {
  it("missing one of its commands is a compile error for a feature's map", () => {
    type SpendHandlers = HandlersFor<keyof typeof spendInputs>
    const partial = {} as Omit<SpendHandlers, 'spend.remove'>
    // @ts-expect-error: `spend.remove` has no handler.
    const handlers: SpendHandlers = partial
    expect(handlers).toBe(partial)
  })

  it('missing a command is a compile error for Handlers', () => {
    const partial = {} as Omit<Handlers, 'clipboard.copy'>
    // @ts-expect-error: `clipboard.copy` has no handler.
    const handlers: Handlers = partial
    expect(handlers).toBe(partial)
  })
})
