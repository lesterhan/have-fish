import { failure } from '@have-fish/core/outcome'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { CommandName, spendInputs } from '../../shared/commands'
import type { Waits } from '../../shared/traits'
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

  it('a handler that waits is a compile error for a command whose traits don’t say so', () => {
    const handler = async () => failure('UNEXPECTED')
    // @ts-expect-error: `clipboard.copy`'s traits don't say it waits.
    const waiting: HandlersFor<'clipboard.copy'>['clipboard.copy'] = handler
    expect(waiting).toBeTypeOf('function')
  })

  it('no command on main waits', () => {
    expectTypeOf<{ [N in CommandName]: Waits<N> }>().toEqualTypeOf<Record<CommandName, false>>()
  })
})
