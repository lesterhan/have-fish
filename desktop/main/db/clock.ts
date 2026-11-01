// The clock's last state lives in the meta row, so a restart never issues a version that is
// older than one it already issued.

import type { Clock } from '@have-fish/core/clock'
import type Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { perConnection } from './prepared'
import { meta } from './schema'

const statements = perConnection((orm) => ({
  load: orm.select({ wallMs: meta.clockWallMs, counter: meta.clockCounter }).from(meta).prepare(),
  // `set` takes no placeholder of its own, so each one is wrapped in `sql`.
  save: orm
    .update(meta)
    .set({
      clockWallMs: sql`${sql.placeholder('wallMs')}`,
      clockCounter: sql`${sql.placeholder('counter')}`,
    })
    .prepare(),
}))

/** The clock as the last write left it. */
export function loadClock(db: Database.Database): Clock {
  const clock = statements(db).load.get()
  if (clock === undefined) throw new Error('The ledger has no meta row')
  return clock
}

/** Call it inside the write's transaction, so the clock and the write commit together. */
export function saveClock(db: Database.Database, clock: Clock): void {
  statements(db).save.run({ wallMs: clock.wallMs, counter: clock.counter })
}
