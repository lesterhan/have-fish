// `bun run test:sqlite` loads this before any test file: it points the SQLite client at a
// fresh database file and migrates it, the SQLite counterpart of `db:migrate:test`.
//
// A file rather than `:memory:`: an in-memory database lives on one connection, and libsql
// gives an open transaction a connection of its own, so the suite would see two databases.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateSqliteFile, readMigrations } from './migrate'

const path = join(mkdtempSync(join(tmpdir(), 'havefish-test-')), 'test.sqlite')
process.env.SQLITE_PATH = path
await migrateSqliteFile(path, readMigrations())
