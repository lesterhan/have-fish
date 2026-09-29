// One person's ledger, copied out of the hosted edition into a file the local app opens as its
// own (#289). The hosted edition is being retired (#372), and the people on it move over once
// (#508): `scripts/export-local.ts` runs this inside the hosted container, and `havefish
// --adopt` puts the file in place on the laptop.
//
// It reads Postgres and writes SQLite in the same process, so it names both dialects' schemas
// directly rather than through `db/schema.ts`, which is only ever one of them. The file is made
// by the app's own migrator, so the binary recognises it, and every row keeps its id, so a
// later link to the sync server finds the ids it already knows.
//
// What stays behind is Fish Pie: its groups, expenses and settlements move to their own
// service (#380), not to the laptop. A transaction a Fish Pie expense wrote into the ledger
// comes along as an ordinary transaction, and an import rule that splits into a group is left
// out, because the group it points at is not in the file.

import { existsSync, renameSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as pg from '../db/pg/schema'
import { danglingReferences } from '../db/sqlite/files'
import { type Migration, migrateSqliteFile, readMigrations } from '../db/sqlite/migrate'
import * as lite from '../db/sqlite/schema'
import { sum } from '../money'

export type HostedDatabase = PostgresJsDatabase<typeof pg>

export type ExportOptions = {
  email: string
  /** The file to write. It must not exist unless `force` is set. */
  out: string
  force?: boolean
  migrations?: readonly Migration[]
}

export type ExportSummary = {
  userId: string
  /** Rows written, by table. */
  rows: Record<string, number>
  /** The patterns of the import rules left out because they split into a Fish Pie group. */
  droppedRules: string[]
  /** How many account and currency balances were compared and matched. */
  balancesChecked: number
}

/** The export stopped before writing `out`. Nothing is left behind. */
export class ExportRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportRefused'
  }
}

// SQLite allows 32,766 bound values in one statement, and a posting has seven columns.
const CHUNK = 500

type Posting = { transactionId: string; accountId: string; amount: string; currency: string }
type Live = { id: string; deletedAt: Date | null }

/**
 * Each account's balance in each currency, as every report reads it: postings not deleted, of
 * transactions not deleted. Keyed `accountId currency`.
 */
export function balances(txs: readonly Live[], postings: readonly (Posting & Live)[]) {
  const live = new Set(txs.filter((t) => !t.deletedAt).map((t) => t.id))
  const amounts = new Map<string, string[]>()
  for (const p of postings) {
    if (p.deletedAt || !live.has(p.transactionId)) continue
    const key = `${p.accountId} ${p.currency}`
    amounts.set(key, [...(amounts.get(key) ?? []), p.amount])
  }
  return new Map([...amounts].map(([key, list]) => [key, sum(list)]))
}

export async function exportLedger(
  hosted: HostedDatabase,
  { email, out, force = false, migrations = readMigrations() }: ExportOptions,
): Promise<ExportSummary> {
  if (existsSync(out) && !force) {
    throw new ExportRefused(`${out} already exists; pass --force to replace it`)
  }
  const [person] = await hosted.select().from(pg.user).where(eq(pg.user.email, email))
  if (!person) throw new ExportRefused(`no user with the email ${email}`)
  const id = person.id

  // Read everything first, in one repeatable-read transaction, so the copy is of one moment
  // even if someone is entering a transaction on hosted while it runs.
  const read = await hosted.transaction(
    async (tx) => ({
      accounts: await tx.select().from(pg.accounts).where(eq(pg.accounts.userId, id)),
      transactions: await tx.select().from(pg.transactions).where(eq(pg.transactions.userId, id)),
      postings: (
        await tx
          .select({ posting: pg.postings })
          .from(pg.postings)
          .innerJoin(pg.transactions, eq(pg.transactions.id, pg.postings.transactionId))
          .where(eq(pg.transactions.userId, id))
      ).map((r) => r.posting),
      csvParsers: await tx.select().from(pg.csvParsers).where(eq(pg.csvParsers.userId, id)),
      userSettings: await tx.select().from(pg.userSettings).where(eq(pg.userSettings.userId, id)),
      importRules: await tx.select().from(pg.importRules).where(eq(pg.importRules.userId, id)),
      accountCoverage: await tx
        .select()
        .from(pg.accountCoverage)
        .where(eq(pg.accountCoverage.userId, id)),
      fxRates: await tx.select().from(pg.fxRates),
    }),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )

  const rules = read.importRules.filter((r) => r.groupId === null)
  const droppedRules = read.importRules.filter((r) => r.groupId !== null).map((r) => r.pattern)
  const rows = {
    user: [person],
    accounts: read.accounts,
    // The group expense each one belongs to stays on hosted, so the link would point at nothing.
    transactions: read.transactions.map((t) => ({ ...t, groupExpenseId: null })),
    postings: read.postings,
    csv_parsers: read.csvParsers,
    user_settings: read.userSettings,
    import_rules: rules,
    account_coverage: read.accountCoverage,
    fx_rates: read.fxRates,
    local_profile: [{ id: 'local', userId: person.id, createdAt: new Date() }],
  }

  // Written beside `out` and renamed into place only once it has checked out, so a failure
  // never leaves a half-copied ledger where the next step would pick it up.
  const partial = `${out}.partial`
  rmSync(partial, { force: true })
  let balancesChecked = 0
  try {
    await migrateSqliteFile(partial, migrations)
    const client = createClient({ url: `file:${partial}` })
    try {
      const local = drizzle(client, { schema: lite })
      const tables = {
        user: lite.user,
        accounts: lite.accounts,
        transactions: lite.transactions,
        postings: lite.postings,
        csv_parsers: lite.csvParsers,
        user_settings: lite.userSettings,
        import_rules: lite.importRules,
        account_coverage: lite.accountCoverage,
        fx_rates: lite.fxRates,
        local_profile: lite.localProfile,
      } as const
      await local.transaction(async (tx) => {
        // In this order, so every foreign key finds its row already there.
        for (const [name, table] of Object.entries(tables)) {
          const list = rows[name as keyof typeof rows] as Record<string, unknown>[]
          for (let i = 0; i < list.length; i += CHUNK) {
            await tx.insert(table).values(list.slice(i, i + CHUNK) as never)
          }
        }
      })

      // Every table holds what was read, and every balance is what hosted says it is.
      for (const [name, table] of Object.entries(tables)) {
        const written = (await local.select().from(table)).length
        const expected = rows[name as keyof typeof rows].length
        if (written !== expected) {
          throw new ExportRefused(`${name}: wrote ${written} rows, expected ${expected}`)
        }
      }
      const before = balances(read.transactions, read.postings)
      const after = balances(
        await local.select().from(lite.transactions),
        await local.select().from(lite.postings),
      )
      const differ = [...new Set([...before.keys(), ...after.keys()])].filter(
        (key) => before.get(key) !== after.get(key),
      )
      if (differ.length > 0) {
        throw new ExportRefused(`balances differ after the copy: ${differ.join(', ')}`)
      }
      balancesChecked = before.size
    } finally {
      client.close()
    }
    // Checked after the fact rather than enforced while writing: libsql gives a transaction a
    // connection of its own, which a PRAGMA on this one would not reach.
    const dangling = await danglingReferences(partial)
    if (dangling > 0) {
      throw new ExportRefused(
        `the copy has ${dangling} row(s) pointing at rows that did not come along`,
      )
    }
    renameSync(partial, out)
    return {
      userId: person.id,
      rows: Object.fromEntries(Object.entries(rows).map(([name, list]) => [name, list.length])),
      droppedRules,
      balancesChecked,
    }
  } catch (e) {
    rmSync(partial, { force: true })
    throw e
  }
}
