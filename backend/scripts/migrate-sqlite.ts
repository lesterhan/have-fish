// `bun run db:migrate:sqlite`: applies the SQLite migrations to the file SQLITE_PATH names, with
// the same migrator the local build runs on every start (src/db/sqlite/migrate.ts), so a file
// migrated by hand is one the app recognises.

import { migrateSqliteFile, readMigrations } from '../src/db/sqlite/migrate'

const path = process.env.SQLITE_PATH ?? 'havefish.sqlite'
const { applied } = await migrateSqliteFile(path, readMigrations())
console.log(applied.length ? `${path}: applied ${applied.join(', ')}` : `${path}: up to date`)
