import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { type Context, contextFor } from '../context'
import { NOW, tempLedger } from '../ledger/fixtures'
import { type Log, runCommand } from './run'

vi.mock('./registry', async (original) => {
  const actual = await original<typeof import('./registry')>()
  const { anAccount } = await import('../ledger/fixtures')
  // No command applies twice, so this one is made to.
  const twice = (ctx: Context) => {
    ctx.apply([anAccount()], ctx.now())
    ctx.apply([anAccount({ path: 'assets:bank', kind: 'bank' })], ctx.now())
    return { ok: true, value: { id: null } }
  }
  return { handlers: { ...actual.handlers, 'account.start': twice } }
})

function setup() {
  const ctx = contextFor({
    ledger: tempLedger(),
    announce: () => {},
    time: { now: () => NOW, timeZone: () => 'UTC' },
  })
  const errors: unknown[] = []
  const log: Log = { info: () => {}, error: (_, e) => errors.push(e) }
  return { ctx, log, errors }
}

const pathsIn = (ctx: Context) =>
  ctx.ledger.db.prepare('SELECT path FROM accounts ORDER BY path').pluck().all()

describe('a command that writes', () => {
  test('a second apply in one command is refused as UNEXPECTED', () => {
    const { ctx, log, errors } = setup()
    expect(runCommand(ctx, 'account.start', { id: randomUUID(), amount: '1' }, log)).toEqual({
      ok: false,
      error: 'UNEXPECTED',
    })
    expect(errors).toEqual([new Error('account.start applied twice')])
  })

  test('the first batch stays, and the second is never written', () => {
    const { ctx, log } = setup()
    runCommand(ctx, 'account.start', { id: randomUUID(), amount: '1' }, log)
    expect(pathsIn(ctx)).toEqual(['assets:cash'])
  })

  test('each command gets its own apply', () => {
    const { ctx, log } = setup()
    for (const name of ['savings', 'travel']) {
      const added = { name, kind: 'bank', currency: null }
      expect(runCommand(ctx, 'account.add', added, log)).toMatchObject({ ok: true })
    }
    expect(pathsIn(ctx)).toEqual(['assets:savings', 'assets:travel'])
  })
})
