// The clock's last state lives in the meta row, so a restart never issues a version that is
// older than one it already issued.

import type { Clock } from '@have-fish/core/clock'
import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { meta } from './schema'

/** The clock as the last write left it. */
export function loadClock(db: Database.Database): Clock {
  const clock = drizzle(db)
    .select({ wallMs: meta.clockWallMs, counter: meta.clockCounter })
    .from(meta)
    .get()
  if (clock === undefined) throw new Error('The ledger has no meta row')
  return clock
}

/** Call it inside the write's transaction, so the clock and the write commit together. */
export function saveClock(db: Database.Database, clock: Clock): void {
  drizzle(db).update(meta).set({ clockWallMs: clock.wallMs, clockCounter: clock.counter }).run()
}
