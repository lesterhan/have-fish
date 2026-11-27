import { randomUUID } from 'node:crypto'
import { failure, type Outcome } from '@have-fish/core/outcome'
import { describe, expect, test, vi } from 'vitest'
import type { Changed } from '../../shared/commands'
import { type Context, contextFor } from '../context'
import { anAccount, NOW, tempLedger } from '../ledger/fixtures'
import { type Log, runCommand } from './run'

// No command on main waits, so these two are made to.
vi.mock('../../shared/traits', async (original) => {
  const actual = await original<typeof import('../../shared/traits')>()
  return {
    ...actual,
    traits: {
      ...actual.traits,
      'account.start': { ...actual.traits['account.start'], waits: true },
      'transaction.page': { ...actual.traits['transaction.page'], waits: true },
    },
  }
})

/** What a test makes one of the two waiting commands do. */
type Handler = (ctx: Context, input: unknown) => Outcome<unknown> | Promise<Outcome<unknown>>

const waiting = vi.hoisted(() => ({
  handler: ((_ctx: Context, _input: unknown) => {
    throw new Error('no handler')
  }) as Handler,
}))

vi.mock('./registry', async (original) => {
  const actual = await original<typeof import('./registry')>()
  const wait = (ctx: Context, input: unknown) => waiting.handler(ctx, input)
  return { handlers: { ...actual.handlers, 'account.start': wait, 'transaction.page': wait } }
})

function setup() {
  const announced: Changed[][] = []
  const ctx = contextFor({
    ledger: tempLedger(),
    announce: (changed) => announced.push(changed),
    time: { now: () => NOW, timeZone: () => 'UTC' },
  })
  const lines: string[] = []
  const errors: unknown[] = []
  const log: Log = { info: (line) => lines.push(line), error: (_, e) => errors.push(e) }
  return { ctx, log, lines, errors, announced }
}

/** A wait a test ends. */
const later = () => Promise.withResolvers<void>()

const START = { id: randomUUID(), amount: '1' }

/** The first page of the ledger's list. */
const PAGE = { from: 0, limit: 100 }

const pathsIn = (ctx: Context) =>
  ctx.ledger.db.prepare('SELECT path FROM accounts ORDER BY path').pluck().all()

describe('a command that waits', () => {
  test('a command that waits answers a Promise', () => {
    const { ctx, log } = setup()
    waiting.handler = async () => {
      await Promise.resolve()
      return { ok: true, value: { id: null } }
    }
    expect(runCommand(ctx, 'account.start', START, log)).toBeInstanceOf(Promise)
  })

  test("a waiting command's value crosses as ok", async () => {
    const { ctx, log } = setup()
    waiting.handler = async () => {
      await Promise.resolve()
      return { ok: true, value: { id: null } }
    }
    expect(await runCommand(ctx, 'account.start', START, log)).toEqual({
      ok: true,
      value: { id: null },
    })
  })

  test("a command whose traits don't wait still answers a Wire", () => {
    const { ctx, log } = setup()
    const added = { name: 'savings', kind: 'bank', currency: null }
    const answered = runCommand(ctx, 'account.add', added, log)
    expect(answered).not.toBeInstanceOf(Promise)
    expect(answered).toMatchObject({ ok: true })
  })

  test('a refusal of a waiting command crosses as { error, detail }', async () => {
    const { ctx, log } = setup()
    waiting.handler = async () => failure('AMOUNT_INVALID', { amount: 'abc' })
    expect(await runCommand(ctx, 'account.start', START, log)).toEqual({
      ok: false,
      error: 'AMOUNT_INVALID',
      detail: { amount: 'abc' },
    })
  })

  test("an input a waiting command's schema refuses is INPUT_MALFORMED", async () => {
    const { ctx, log } = setup()
    expect(await runCommand(ctx, 'account.start', { ...START, id: 'x' }, log)).toMatchObject({
      ok: false,
      error: 'INPUT_MALFORMED',
    })
  })

  test("a waiting command's handler is never called for a malformed input", async () => {
    const { ctx, log } = setup()
    let called = false
    waiting.handler = async () => {
      called = true
      return { ok: true, value: { id: null } }
    }
    await runCommand(ctx, 'account.start', { ...START, id: 'x' }, log)
    expect(called).toBe(false)
  })

  test('a rejected wait answers UNEXPECTED', async () => {
    const { ctx, log } = setup()
    waiting.handler = async () => {
      throw new Error('lost')
    }
    expect(await runCommand(ctx, 'account.start', START, log)).toEqual({
      ok: false,
      error: 'UNEXPECTED',
      detail: undefined,
    })
  })

  test("a rejected wait's error is logged, and its line says UNEXPECTED", async () => {
    const { ctx, log, lines, errors } = setup()
    waiting.handler = async () => {
      throw new Error('lost')
    }
    await runCommand(ctx, 'account.start', START, log)
    expect(errors).toEqual([new Error('lost')])
    expect(lines[0]).toMatch(/^account\.start \d+ms UNEXPECTED$/)
  })

  test('a handler that throws before it returns a Promise is answered, not thrown', async () => {
    const { ctx, log } = setup()
    waiting.handler = () => {
      throw new Error('lost')
    }
    const answered = runCommand(ctx, 'account.start', START, log)
    await expect(answered).resolves.toEqual({
      ok: false,
      error: 'UNEXPECTED',
      detail: undefined,
    })
  })

  test("a rejected wait's log never holds the input", async () => {
    const { ctx, log, lines } = setup()
    waiting.handler = async () => {
      throw new Error('lost')
    }
    await runCommand(ctx, 'account.start', { ...START, amount: '4242.17' }, log)
    expect(lines.filter((line) => /4242/.test(line))).toEqual([])
  })

  test("a waiting command's line is written once its wait is over", async () => {
    const { ctx, log, lines } = setup()
    const wait = later()
    waiting.handler = async () => {
      await wait.promise
      return { ok: true, value: { id: null } }
    }
    const answered = runCommand(ctx, 'account.start', START, log)
    expect(lines).toEqual([])
    wait.resolve()
    await answered
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^account\.start \d+ms ok$/)
  })

  test("a waiting command's line counts its wait", async () => {
    const { ctx, log, lines } = setup()
    waiting.handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true, value: { id: null } }
    }
    await runCommand(ctx, 'account.start', START, log)
    const [line = ''] = lines
    const ms = Number(/^account\.start (\d+)ms ok$/.exec(line)?.[1])
    expect(ms).toBeGreaterThanOrEqual(15)
  })

  test('a second apply across a wait is refused as UNEXPECTED', async () => {
    const { ctx, log, errors } = setup()
    waiting.handler = async (ctx) => {
      await Promise.resolve()
      ctx.apply([anAccount()], ctx.now())
      ctx.apply([anAccount({ path: 'assets:bank', kind: 'bank' })], ctx.now())
      return { ok: true, value: { id: null } }
    }
    expect(await runCommand(ctx, 'account.start', START, log)).toEqual({
      ok: false,
      error: 'UNEXPECTED',
    })
    expect(errors).toEqual([new Error('account.start applied twice')])
  })

  test("a waiting command's first batch stays, and its second is never written", async () => {
    const { ctx, log } = setup()
    waiting.handler = async (ctx) => {
      await Promise.resolve()
      ctx.apply([anAccount()], ctx.now())
      ctx.apply([anAccount({ path: 'assets:bank', kind: 'bank' })], ctx.now())
      return { ok: true, value: { id: null } }
    }
    await runCommand(ctx, 'account.start', START, log)
    expect(pathsIn(ctx)).toEqual(['assets:cash'])
  })

  test('a waiting command that says it writes nothing is refused if it applies', async () => {
    const { ctx, log, errors } = setup()
    waiting.handler = async (ctx) => {
      await Promise.resolve()
      ctx.apply([anAccount()], ctx.now())
      return { ok: true, value: null }
    }
    expect(await runCommand(ctx, 'transaction.page', PAGE, log)).toEqual({
      ok: false,
      error: 'UNEXPECTED',
    })
    expect(errors).toEqual([new Error('transaction.page says it writes nothing')])
    expect(pathsIn(ctx)).toEqual([])
  })

  test('a waiting write is announced once its answer is in', async () => {
    const { ctx, log, announced } = setup()
    const wait = later()
    waiting.handler = async (ctx) => {
      await wait.promise
      ctx.apply([anAccount()], ctx.now())
      return { ok: true, value: { id: null } }
    }
    const answered = runCommand(ctx, 'account.start', START, log)
    expect(announced).toEqual([])
    wait.resolve()
    await answered
    expect(announced).toHaveLength(1)
  })
})
