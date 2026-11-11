// Records a seeded ledger as a scene's fixture: each list the window asks for, read through
// runCommand as the window reads it, so a fixture holds nothing the window couldn't see.
// Seeds only, by profile name: no path to a real ledger can be passed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDays, weekOf } from '@have-fish/core/calendar-date'
import { type Log, runCommand } from '../../main/commands/run'
import { contextFor } from '../../main/context'
import type { Ledger } from '../../main/db/ledger'
import { type Fixture, noonOf, SCENE_TODAY } from '../../scenes/fixture'
import type { CommandName, DayNet, InputOf, ListedTransaction, Values } from '../../shared/commands'
import { profileNamed, seedInto } from './commands'
import { open, sandbox } from './sandbox'

const quiet: Log = { info: () => {}, error: () => {} }

/** Every answer the window would get, recorded. Reads only: a scene holds no undo or typing. */
export function recordFrom(
  ledger: Ledger,
  seeded: { profile: string; seed: string; today: string },
): Fixture {
  const ctx = contextFor({ ledger, announce: () => {} })
  const ask = <N extends CommandName>(name: N, input: InputOf<N>): Values[N] => {
    const answered = runCommand(ctx, name, input, quiet)
    if (!answered.ok) throw new Error(`${name} refused: ${JSON.stringify(answered)}`)
    return answered.value
  }

  const rows: ListedTransaction[] = []
  const nets: DayNet[] = []
  for (let from = 0; ; from += 500) {
    const page = ask('transaction.page', { from, limit: 500 })
    rows.push(...page.rows)
    nets.push(...page.nets)
    if (rows.length >= page.total) break
  }

  // The week the page opens on, its year before, and the one after, keyed by start.
  const thisWeek = weekOf(seeded.today)
  const reports: Fixture['reports'] = {}
  let currency = ''
  for (let back = 12; back >= 0; back--) {
    const start = addDays(thisWeek.start, -7 * back)
    const report = ask('report.spending', { start, end: addDays(start, 6) })
    if (back === 0) currency = report.currency
    reports[start] = report
  }
  const after = addDays(thisWeek.start, 7)
  reports[after] = ask('report.spending', { start: after, end: addDays(after, 6) })

  return {
    profile: seeded.profile,
    seed: seeded.seed,
    today: seeded.today,
    currency,
    rows,
    days: ask('transaction.days', {}),
    nets,
    accounts: ask('account.list', {}),
    paths: ask('path.list', {}),
    assumedFrom: ask('spend.assumedFrom', {}).id,
    reports,
  }
}

/** Seeds each named profile afresh in a temp folder, records it, and removes the folder. */
export function record(profiles: readonly string[], into: string): void {
  mkdirSync(into, { recursive: true })
  for (const name of profiles) {
    if (!profileNamed(name).ledger) {
      throw new Error(`${name} has no ledger to record; its fixture is EMPTY`)
    }
    const base = mkdtempSync(join(tmpdir(), 'havefish-record-'))
    try {
      const where = sandbox(name, base)
      const seeded = { profile: name, seed: '1', today: SCENE_TODAY }
      seedInto(where, name, {
        seed: seeded.seed,
        today: seeded.today,
        nowMs: noonOf(seeded.today),
      })
      const ledger = open(where, noonOf(seeded.today))
      try {
        writeFileSync(join(into, `${name}.json`), `${JSON.stringify(recordFrom(ledger, seeded))}\n`)
      } finally {
        ledger.close()
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  }
}
