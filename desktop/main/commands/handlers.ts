// The type of a handler map: one handler for each of `Ns`, taking its parsed input. A feature
// types its own map with it, without importing the registry.

import type { Outcome } from '@have-fish/core/outcome'
import type { z } from 'zod'
import type { CommandName, inputs, Values } from '../../shared/commands'
import type { Context } from '../context'

export type HandlersFor<Ns extends CommandName> = {
  [N in Ns]: (ctx: Context, input: z.output<(typeof inputs)[N]>) => Outcome<Values[N]>
}

/** Every command's handler: a command without one fails to compile. */
export type Handlers = HandlersFor<CommandName>
