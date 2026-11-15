# The ledger file

This folder opens, claims and migrates the one SQLite file the ledger lives in. A file once saved
is never lost, half-written or quietly changed. Each rule below names the test that fails when it
breaks.

- Four pragmas on every open (`journal_mode = WAL`, `synchronous = FULL`, `foreign_keys = ON`,
  `busy_timeout`), `FULL` set again each time, since better-sqlite3 reopens a WAL file at
  `NORMAL`: `ledger.test.ts`, "pragmas are set properly" and "a reopened file is still
  synchronous FULL".
- The application id never changes: `ledger.test.ts`, "a new file is stamped with have-fish's
  application id". `claim` runs before WAL, so another app's file is left as it was: "refuses an
  SQLite file with no id and tables of its own, and leaves it as it was".
- Migrations come from `drizzle-kit generate` (a hand edit says so in its SQL), then
  `bun run db:bundle`: `tools/bundle-migrations.test.ts`, "the bundled migrations are the ones in
  drizzle/".
- Each migration runs in a transaction, with a foreign-key check: `migrate.test.ts`, "a migration
  that fails part-way leaves the file at the one before" and "a migration that leaves a row
  pointing at nothing is rolled back".
- Every migration upgrades a file with data in it, with no new test: `migrations.test.ts`.
- The file is copied through SQLite (`VACUUM INTO`), never with `fs`: `ledger.test.ts`, "the
  backup has commits still in the WAL, which a file copy would miss".
- A file a newer build migrated is refused untouched: `ledger.test.ts`, "a file a newer build
  migrated is refused, and its bytes are unchanged".
