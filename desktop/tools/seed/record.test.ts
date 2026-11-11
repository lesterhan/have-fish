import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDays, weekOf } from '@have-fish/core/calendar-date'
import { describe, expect, onTestFinished, test } from 'vitest'
import { type Log, runCommand } from '../../main/commands/run'
import { type Context, contextFor } from '../../main/context'
import type { Ledger } from '../../main/db/ledger'
import { aLedgerOf } from '../../main/ledger/fixtures'
import { noonOf, SCENE_TODAY } from '../../scenes/fixture'
import type { CommandName, InputOf, Values } from '../../shared/commands'
import { seedInto } from './commands'
import { record, recordFrom } from './record'
import { open, sandbox, type Where } from './sandbox'

const quiet: Log = { info: () => {}, error: () => {} }

/** What the window would get for `name`, straight from the ledger. */
function asker(ledger: Ledger) {
  const ctx: Context = contextFor({ ledger, announce: () => {} })
  return <N extends CommandName>(name: N, input: InputOf<N>): Values[N] => {
    const answered = runCommand(ctx, name, input, quiet)
    if (!answered.ok) throw new Error(`${name} refused: ${JSON.stringify(answered)}`)
    return answered.value
  }
}

/** The starter profile seeded as scenes:record seeds it, in a temp folder the test removes. */
function seededStarter(): Ledger {
  const base = mkdtempSync(join(tmpdir(), 'havefish-record-test-'))
  onTestFinished(() => rmSync(base, { recursive: true, force: true }))
  const where: Where = sandbox('starter', base)
  seedInto(where, 'starter', { seed: '1', today: SCENE_TODAY, nowMs: noonOf(SCENE_TODAY) })
  const ledger = open(where, noonOf(SCENE_TODAY))
  onTestFinished(() => ledger.close())
  return ledger
}

const seeded = { profile: 'starter', seed: '1', today: SCENE_TODAY }

describe('recordFrom', () => {
  test('the fixture is what the window would read', () => {
    const ledger = seededStarter()
    const fixture = recordFrom(ledger, seeded)
    const ask = asker(ledger)
    const page = ask('transaction.page', { from: 0, limit: 500 })
    expect(fixture.rows).toEqual(page.rows)
    expect(fixture.days.reduce((sum, d) => sum + d.count, 0)).toBe(fixture.rows.length)
    expect(fixture.nets.map((n) => n.date).sort()).toEqual(fixture.days.map((d) => d.date).sort())
    expect(fixture.accounts).toEqual(ask('account.list', {}))
    expect(fixture.paths).toEqual(ask('path.list', {}))
  })

  test('reports holds the week of today, the twelve before it and the one after', () => {
    const ledger = seededStarter()
    const fixture = recordFrom(ledger, seeded)
    const thisWeek = weekOf(SCENE_TODAY)
    const starts = Array.from({ length: 14 }, (_, i) => addDays(thisWeek.start, 7 * (i - 12)))
    expect(Object.keys(fixture.reports).sort()).toEqual([...starts].sort())
    const ask = asker(ledger)
    for (const start of starts) {
      expect(fixture.reports[start]).toEqual(
        ask('report.spending', { start, end: addDays(start, 6) }),
      )
    }
  })

  test('its currency is the one report.spending answers in', () => {
    const ledger = seededStarter()
    const fixture = recordFrom(ledger, seeded)
    const thisWeek = weekOf(SCENE_TODAY)
    expect(fixture.currency).toBe(
      asker(ledger)('report.spending', { start: thisWeek.start, end: thisWeek.end }).currency,
    )
  })

  test('the same seed and today record the same fixture twice', () => {
    expect(recordFrom(seededStarter(), seeded)).toEqual(recordFrom(seededStarter(), seeded))
  })

  test('a ledger past one page is read in full', () => {
    const ledger = aLedgerOf(600)
    const fixture = recordFrom(ledger, { profile: 'test', seed: '1', today: '2026-10-29' })
    expect(fixture.rows.length).toBeGreaterThan(500)
    expect(fixture.rows).toHaveLength(
      asker(ledger)('transaction.page', { from: 0, limit: 500 }).total,
    )
  })
})

describe('record', () => {
  test('writes <into>/<profile>.json, and the folder it seeded in is gone', () => {
    const into = mkdtempSync(join(tmpdir(), 'havefish-fixtures-'))
    onTestFinished(() => rmSync(into, { recursive: true, force: true }))
    const tempBefore = readdirSync(tmpdir()).filter((d) => d.startsWith('havefish-record-'))
    record(['starter'], into)
    expect(readdirSync(tmpdir()).filter((d) => d.startsWith('havefish-record-'))).toEqual(
      tempBefore,
    )
    const written = JSON.parse(readFileSync(join(into, 'starter.json'), 'utf8'))
    expect(written).toEqual(recordFrom(seededStarter(), seeded))
  })

  test('the empty profile is refused: it has no ledger, and its fixture is EMPTY', () => {
    const into = mkdtempSync(join(tmpdir(), 'havefish-fixtures-'))
    onTestFinished(() => rmSync(into, { recursive: true, force: true }))
    expect(() => record(['empty'], into)).toThrow(/empty/)
  })
})
