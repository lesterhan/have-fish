// `havefish --adopt <file>`: makes a ledger file this install's own (#289). The file is usually
// one `scripts/export-local.ts` wrote from the hosted edition, and this saves its owner from
// finding the data directory and copying it there by hand.
//
// The launcher calls it while holding the data directory's lock and before anything opens the
// database. It is careful in the order a person would be:
// - it checks the new file before touching the old one;
// - it refuses to replace a ledger that has transactions in it;
// - it copies the old file into `backups/` before replacing it;
// - it replaces the old file only once the new one is ready.

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { copyDatabase, ownerCount, transactionCount } from '../db/sqlite/files'
import { type Migration, migrateSqliteFile, SchemaTooNewError } from '../db/sqlite/migrate'

/** The file was not adopted, and nothing in the data directory changed. */
export class AdoptRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdoptRefused'
  }
}

export type AdoptPaths = { database: string; backups: string }

export type AdoptResult = {
  /** Where the ledger that was there before went, or null when there was none. */
  backup: string | null
}

export async function adoptLedger(
  source: string,
  paths: AdoptPaths,
  migrations: readonly Migration[],
  now = new Date(),
): Promise<AdoptResult> {
  if (!existsSync(source)) throw new AdoptRefused(`there is no file at ${source}`)

  // Staged beside the ledger, so the last step is a rename on one filesystem. Copied through
  // SQLite, which reads the source without writing to it and says plainly if it is not a
  // database at all.
  const staged = `${paths.database}.adopting`
  rmSync(staged, { force: true })
  try {
    await copyDatabase(source, staged).catch(() => {
      throw new AdoptRefused(`${source} is not a have-fish ledger`)
    })

    try {
      await migrateSqliteFile(staged, migrations)
    } catch (e) {
      if (e instanceof SchemaTooNewError) {
        throw new AdoptRefused(
          `${source} was written by a newer have-fish than this one; update have-fish first`,
        )
      }
      throw new AdoptRefused(`${source} is not a have-fish ledger`)
    }
    if ((await ownerCount(staged)) !== 1) {
      throw new AdoptRefused(`${source} is not a have-fish ledger: it has no owner`)
    }

    let backup: string | null = null
    if (existsSync(paths.database)) {
      const entered = await transactionCount(paths.database)
      if (entered > 0) {
        throw new AdoptRefused(
          `the ledger at ${paths.database} already has ${entered} transaction(s) in it. ` +
            'Move that file somewhere else first if you mean to replace it.',
        )
      }
      mkdirSync(paths.backups, { recursive: true, mode: 0o700 })
      backup = join(paths.backups, `pre-adopt-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`)
      await copyDatabase(paths.database, backup)
    }

    // The old file's WAL belongs to the old file: left beside the new one, SQLite would replay
    // it into the adopted ledger.
    rmSync(`${paths.database}-wal`, { force: true })
    rmSync(`${paths.database}-shm`, { force: true })
    renameSync(staged, paths.database)
    return { backup }
  } finally {
    rmSync(staged, { force: true })
  }
}
