import { describe, expect, test } from 'vitest'
import type { Changed } from '../../shared/commands'
import { contextFor } from '../context'
import { NOW, tempLedger } from '../ledger/fixtures'
import { type Log, runCommand } from './run'

function setup(copied: string[] = []) {
  const ledger = tempLedger()
  const announced: Changed[][] = []
  const ctx = contextFor({
    ledger,
    announce: (changed) => announced.push(changed),
    time: { now: () => NOW, timeZone: () => 'UTC' },
    copy: (text) => copied.push(text),
  })
  const lines: string[] = []
  const errors: unknown[] = []
  const log: Log = { info: (line) => lines.push(line), error: (_, e) => errors.push(e) }
  return { ledger, ctx, log, lines, errors, announced }
}

/** The first page of the ledger's list. */
const PAGE = { from: 0, limit: 100 }

describe('runCommand', () => {
  test("a command's value crosses as ok", () => {
    const { ctx, log } = setup()
    expect(runCommand(ctx, 'transaction.page', PAGE, log)).toEqual({
      ok: true,
      value: { total: 0, from: 0, rows: [], nets: [] },
    })
  })

  test('a refusal crosses as { error, detail }', () => {
    const { ctx, log } = setup()
    expect(runCommand(ctx, 'spend.write', { amount: 'abc', description: '' }, log)).toEqual({
      ok: false,
      error: 'AMOUNT_INVALID',
      detail: { amount: 'abc' },
    })
  })

  test('a written spend is listed', () => {
    const { ctx, log } = setup()
    const written = runCommand(ctx, 'spend.write', { amount: '4.50', description: 'Coffee' }, log)
    const listed = runCommand(ctx, 'transaction.page', PAGE, log)
    expect(written.ok && listed.ok && listed.value.rows.map((t) => t.id)).toEqual([
      written.ok && written.value.id,
    ])
  })

  test.each([
    [{ amount: 4.5, description: '' }, 'amount', 'invalid_type'],
    [{ amount: '4.50' }, 'description', 'invalid_type'],
    [{ amount: '4.50', description: '', date: '2026-01-01T00' }, 'date', 'too_big'],
    [{ amount: '4.50', description: '', when: '2026-01-01' }, 'when', 'unrecognized_keys'],
    [{ amount: '4'.repeat(65), description: '' }, 'amount', 'too_big'],
    [{ amount: '4.50', description: '', from: 'visa' }, 'from', 'invalid_format'],
    ['4.50', '', 'invalid_type'],
    [undefined, '', 'invalid_type'],
  ])('input %j that its schema refuses never reaches the command', (input, path, issue) => {
    const { ledger, ctx, log } = setup()
    expect(runCommand(ctx, 'spend.write', input, log)).toEqual({
      ok: false,
      error: 'INPUT_MALFORMED',
      detail: { path, issue },
    })
    expect(ledger.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0)
  })

  test('text for the clipboard is written, and nothing in the ledger changes', () => {
    const copied: string[] = []
    const { ctx, log, announced } = setup(copied)
    expect(runCommand(ctx, 'clipboard.copy', { text: '2026-11-04 Cafe' }, log)).toEqual({
      ok: true,
      value: null,
    })
    expect(copied).toEqual(['2026-11-04 Cafe'])
    expect(announced).toEqual([])
  })

  test('the paths cross as a list', () => {
    const { ctx, log } = setup()
    runCommand(ctx, 'spend.write', { amount: '1', description: '', to: { category: 'food' } }, log)
    expect(runCommand(ctx, 'path.list', {}, log)).toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        { id: expect.any(String), path: 'expenses:food', kind: 'category', lastUsed: NOW },
      ]),
    })
  })

  test('the account a spend would come out of crosses as its id', () => {
    const { ctx, log } = setup()
    expect(runCommand(ctx, 'spend.assumedFrom', {}, log)).toEqual({ ok: true, value: { id: null } })
  })

  test('an edit names its spend by a UUID, or never reaches the command', () => {
    const { ctx, log } = setup()
    const edit = { id: '../../etc', amount: '5', description: '' }
    expect(runCommand(ctx, 'spend.edit', edit, log)).toEqual({
      ok: false,
      error: 'INPUT_MALFORMED',
      detail: { path: 'id', issue: 'invalid_format' },
    })
  })

  test('an edited spend is listed with its new values', () => {
    const { ctx, log } = setup()
    const written = runCommand(ctx, 'spend.write', { amount: '4.50', description: 'Coffee' }, log)
    if (!written.ok) throw new Error('not written')
    const { id } = written.value

    expect(runCommand(ctx, 'spend.edit', { id, amount: '5', description: 'Tea' }, log)).toEqual({
      ok: true,
      value: { id },
    })
    const listed = runCommand(ctx, 'transaction.page', PAGE, log)
    expect(listed.ok && listed.value.rows).toMatchObject([
      { id, description: 'Tea', simple: { amount: '5.00', currency: 'CAD' } },
    ])
  })

  test.each(['spend.burn', 'toString', '__proto__', ''])('%j is not a command', (name) => {
    const { ctx, log } = setup()
    expect(runCommand(ctx, name, {}, log)).toEqual({
      ok: false,
      error: 'COMMAND_UNKNOWN',
      detail: { name },
    })
  })

  test('a name that is not text is not a command', () => {
    const { ctx, log } = setup()
    expect(runCommand(ctx, 42, {}, log)).toEqual({
      ok: false,
      error: 'COMMAND_UNKNOWN',
      detail: { name: '42' },
    })
  })

  test('a command that throws crosses as UNEXPECTED, and the error goes to the log', () => {
    const { ledger, ctx, log, errors } = setup()
    ledger.close()

    expect(runCommand(ctx, 'transaction.page', PAGE, log)).toEqual({
      ok: false,
      error: 'UNEXPECTED',
      detail: undefined,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })

  test('logs one line per command: its name, how long it took, and how it ended', () => {
    const { ctx, log, lines } = setup()
    runCommand(ctx, 'spend.write', { amount: '4.50', description: 'Coffee' }, log)
    runCommand(ctx, 'spend.write', { amount: 'abc', description: 'Rent' }, log)
    runCommand(ctx, 'nope', {}, log)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^spend\.write \d+ms ok$/)
    expect(lines[1]).toMatch(/^spend\.write \d+ms AMOUNT_INVALID$/)
    expect(lines[2]).toMatch(/^\(unknown\) \d+ms COMMAND_UNKNOWN$/)
  })

  test('never logs the input', () => {
    const { ctx, log, lines, errors } = setup()
    runCommand(ctx, 'spend.write', { amount: 'abc', description: 'Rent to Kim' }, log)
    runCommand(ctx, 'spend.write', { amount: 7, description: 'Rent to Kim' }, log)
    runCommand(ctx, 'spend.write', { amount: '4', description: 'Rent to Kim' }, log)

    expect(lines.join('\n')).not.toMatch(/Kim|abc/)
    expect(errors).toEqual([])
  })
  test('a command that writes nothing says nothing', () => {
    const { ctx, log, announced } = setup()
    runCommand(ctx, 'transaction.page', PAGE, log)
    runCommand(ctx, 'spend.write', { amount: 'abc', description: '' }, log)
    expect(announced).toEqual([])
  })
})
