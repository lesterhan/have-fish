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
import { traits, type Waits } from '../../shared/traits'
import type { Context } from '../context'
import { handlers } from './registry'

export type Log = { info(line: string): void; error(line: string, error: unknown): void }

/** What `runCommand` gives for `N`: a Promise for a command that waits, else the answer. */
export type Answer<N extends CommandName> =
  Waits<N> extends true ? Promise<Wire<Values[N]>> : Wire<Values[N]>

/** Runs `name` with `input`, both straight from the window, so neither is trusted. */
export function runCommand<N extends CommandName>(
  ctx: Context,
  name: N,
  input: unknown,
  log: Log,
): Answer<N>
export function runCommand(
  ctx: Context,
  name: unknown,
  input: unknown,
  log: Log,
): Wire<unknown> | Promise<Wire<unknown>>
export function runCommand(
  ctx: Context,
  name: unknown,
  input: unknown,
  log: Log,
): Wire<unknown> | Promise<Wire<unknown>> {
  const started = performance.now()
  const command = isCommand(name) ? name : undefined
  /** Flushed and logged once its wait, if any, is over, so the time counts it. */
  const finish = (outcome: Outcome<unknown>): Wire<unknown> => {
    // Once per command, after all its batches: a save of three edits is one notice.
    ctx.flush()
    const ms = Math.round(performance.now() - started)
    // Never the input: it holds what you spent and on what.
    log.info(`${command ?? '(unknown)'} ${ms}ms ${outcome.ok ? 'ok' : outcome.failure.code}`)
    return toWire(outcome)
  }
  const ran = run(ctx, command, name, input, log)
  // Only a command whose traits say it waits answers a Promise; tsc holds its handler to it.
  if (command !== undefined && traits[command].waits === true) {
    return Promise.resolve(ran)
      .catch((e: unknown) => threw(command, e, log))
      .then(finish)
  }
  return finish(ran as Outcome<unknown>)
}

function run(
  ctx: Context,
  command: CommandName | undefined,
  name: unknown,
  input: unknown,
  log: Log,
): Outcome<unknown> | Promise<Outcome<unknown>> {
  if (command === undefined) return failure('COMMAND_UNKNOWN', { name: String(name) })
  try {
    const parsed = inputs[command].safeParse(input)
    if (!parsed.success) return failure('INPUT_MALFORMED', firstIssue(parsed.error))
    // tsc can't tie `parsed.data` to `command`'s own handler; the schema just did.
    const handler = handlers[command] as (
      ctx: Context,
      input: unknown,
    ) => Outcome<unknown> | Promise<Outcome<unknown>>
    return handler(
      traits[command].writes ? applyingOnce(ctx, command) : readOnly(ctx, command),
      parsed.data,
    )
  } catch (e) {
    return threw(command, e, log)
  }
}

/** A handler that threw, or whose wait was refused: logged without its input. */
function threw(command: CommandName, e: unknown, log: Log): Outcome<never> {
  log.error(`${command} threw`, e)
  return failure('UNEXPECTED')
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

/** `ctx` for a command that writes: it applies once, so a crash can't leave it half done. */
function applyingOnce(ctx: Context, command: CommandName): Context {
  let applied = false
  return {
    ...ctx,
    apply(docs, now) {
      if (applied) throw new Error(`${command} applied twice`)
      applied = true
      return ctx.apply(docs, now)
    },
  }
}

const isCommand = (name: unknown): name is CommandName =>
  typeof name === 'string' && Object.hasOwn(inputs, name)

function toWire<T>(outcome: Outcome<T>): Wire<T> {
  return outcome.ok ? outcome : wireFailure(outcome.failure)
}
