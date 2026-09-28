// Transactions that overlap in time, on either dialect (#482).
//
// Postgres gives each transaction a connection and lets them wait on each other. SQLite has
// one writer, and on one thread a writer cannot wait for another: without the in-process turn
// in `db/sqlite/client.ts`, a second transaction or a plain write that arrives while one is
// open fails with SQLITE_BUSY (#285). The app used to avoid that by accident of scheduling;
// these tests start the work in the same tick on purpose, and hold each transaction open
// across a timer, which is the kind of await that breaks the accident.

import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { clearDatabase } from '../test-utils'
import { db, dialect } from './index'
import { fxRates } from './schema'

/** Why `work` failed: the driver's own message, which Drizzle puts on the error's `cause`. */
async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (e) {
    const err = e as Error
    return `${err.message} ${(err.cause as Error | undefined)?.message ?? ''}`
  }
  return 'did not fail'
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 5))

function rate(date: string, quoteCurrency = 'CAD') {
  return { date, baseCurrency: 'EUR', quoteCurrency, rate: '1.500000' }
}

async function datesWritten() {
  const rows = await db.select({ date: fxRates.date }).from(fxRates)
  return rows.map((r) => r.date).sort()
}

beforeEach(async () => {
  await clearDatabase()
})

describe('transactions that overlap', () => {
  it('all commit when twelve start in the same tick', async () => {
    const days = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`)

    const outcomes = await Promise.allSettled(
      days.map((day) =>
        db.transaction(async (tx) => {
          await tx.insert(fxRates).values(rate(day))
          await pause()
          await tx.insert(fxRates).values(rate(day, 'USD'))
        }),
      ),
    )

    expect(outcomes.filter((o) => o.status === 'rejected')).toEqual([])
    expect(await datesWritten()).toEqual(days.flatMap((d) => [d, d]))
  })

  it('let a plain write in once the open one commits', async () => {
    const open = db.transaction(async (tx) => {
      await tx.insert(fxRates).values(rate('2026-02-01'))
      await pause()
    })
    await Promise.resolve()
    const plain = db.insert(fxRates).values(rate('2026-02-02'))

    await Promise.all([open, plain])

    expect(await datesWritten()).toEqual(['2026-02-01', '2026-02-02'])
  })

  it('let a read through while one is open', async () => {
    await db.insert(fxRates).values(rate('2026-03-01'))
    let seen: string[] = []

    await db.transaction(async (tx) => {
      await tx.insert(fxRates).values(rate('2026-03-02'))
      // Read outside the transaction: it sees what was committed, not what is in flight.
      seen = await datesWritten()
    })

    expect(seen).toEqual(['2026-03-01'])
  })

  it('carry on after one rolls back', async () => {
    const failed = db.transaction(async (tx) => {
      await tx.insert(fxRates).values(rate('2026-04-01'))
      await pause()
      throw new Error('changed my mind')
    })
    const next = db.transaction(async (tx) => {
      await tx.insert(fxRates).values(rate('2026-04-02'))
    })

    await expect(failed).rejects.toThrow('changed my mind')
    await next
    expect(await datesWritten()).toEqual(['2026-04-02'])
  })
})

// On Postgres a write through `db` inside a transaction runs on another connection and quietly
// escapes it. On SQLite it would wait for its own transaction forever, so it is refused.
describe.skipIf(dialect !== 'sqlite')(
  'on SQLite, a write through `db` inside a transaction',
  () => {
    it('is refused rather than waiting forever', async () => {
      const attempt = db.transaction(async () => {
        await db.insert(fxRates).values(rate('2026-05-01'))
      })

      expect(await failure(attempt)).toContain('inside a transaction would wait for it forever')
      expect(await datesWritten()).toEqual([])
    })

    it('is refused for a nested `db.transaction` too', async () => {
      const attempt = db.transaction(async () => {
        await db.transaction(async (inner) => {
          await inner.delete(fxRates).where(eq(fxRates.date, '2026-05-02'))
        })
      })

      expect(await failure(attempt)).toContain('inside a transaction would wait for it forever')
    })
  },
)
