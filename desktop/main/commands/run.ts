// The edge between the window and the ledger: every command passes through here, so its input
// is parsed, its failure takes the window's shape, and it gets one line in the log.

import { firstIssue } from '@have-fish/core/first-issue'
import { failure, type Outcome } from '@have-fish/core/outcome'
import {
  type CommandName,
  inputs,
  type Values,
  type Wire,
  wireFailure,
} from '../../shared/commands'
import { traits } from '../../shared/traits'
import type { Context } from '../context'
import { handlers } from './registry'

export type Log = { info(line: string): void; error(line: string, error: unknown): void }

/** Runs `name` with `input`, both straight from the window, so neither is trusted. */
export function runCommand<N extends CommandName>(
  ctx: Context,
  name: N,
  input: unknown,
  log: Log,
): Wire<Values[N]>
export function runCommand(ctx: Context, name: unknown, input: unknown, log: Log): Wire<unknown>
export function runCommand(ctx: Context, name: unknown, input: unknown, log: Log): Wire<unknown> {
  const started = performance.now()
  const command = isCommand(name) ? name : undefined
  const outcome = run(ctx, command, name, input, log)
  // Once per command, after all its batches: a save of three edits is one notice.
  ctx.flush()
  const ms = Math.round(performance.now() - started)
  // Never the input: it holds what you spent and on what.
  log.info(`${command ?? '(unknown)'} ${ms}ms ${outcome.ok ? 'ok' : outcome.failure.code}`)
  return toWire(outcome)
}

function run(
  ctx: Context,
  command: CommandName | undefined,
  name: unknown,
  input: unknown,
  log: Log,
): Outcome<unknown> {
  if (command === undefined) return failure('COMMAND_UNKNOWN', { name: String(name) })
  try {
    const parsed = inputs[command].safeParse(input)
    if (!parsed.success) return failure('INPUT_MALFORMED', firstIssue(parsed.error))
    // tsc can't tie `parsed.data` to `command`'s own handler; the schema just did.
    const handler = handlers[command] as (ctx: Context, input: unknown) => Outcome<unknown>
    return handler(traits[command].writes ? ctx : readOnly(ctx, command), parsed.data)
  } catch (e) {
    log.error(`${command} threw`, e)
    return failure('UNEXPECTED')
  }
}

/** `ctx` for a command that says it writes nothing: if it applies, it throws. */
function readOnly(ctx: Context, command: CommandName): Context {
  return {
    ...ctx,
    apply() {
      throw new Error(`${command} says it writes nothing`)
    },
  }
}

const isCommand = (name: unknown): name is CommandName =>
  typeof name === 'string' && Object.hasOwn(inputs, name)

function toWire<T>(outcome: Outcome<T>): Wire<T> {
  return outcome.ok ? outcome : wireFailure(outcome.failure)
}
