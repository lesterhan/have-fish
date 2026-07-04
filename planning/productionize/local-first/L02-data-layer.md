# L02 — Data layer: embedded database & user-owned files

**Status:** Draft (first full pass 2026-07-04)
**Decision this doc drives:** SQLite vs PGlite — the biggest technical fork in the
track, because it decides whether we maintain one SQL dialect or two.

## The two candidates

### PGlite (Postgres compiled to WASM, by ElectricSQL)

- **The killer argument:** it *is* Postgres. The existing Drizzle `pg-core` schema,
  every query, every generated migration, and the raw SQL fragments all run
  unchanged. Drizzle supports it as a first-class driver. One dialect forever, both
  tracks share everything.
- ~3 MB gzipped, runs in Bun, persists to the filesystem.
- **Concerns:** young project; **single connection only** (fine for a single-user
  local app, but rules out any concurrency we take for granted); ecosystem mostly
  positions it for tests/dev today; unknowns inside a `bun --compile` binary (WASM
  loading from embedded assets — must be part of the L01 P1 spike); data directory
  is a Postgres-style dir tree, not one tidy file (weaker "your data is this file"
  story); long-term maintenance bet on ElectricSQL.

### SQLite via `bun:sqlite`

- **The killer arguments:** boring, indestructible, and *built into the Bun runtime*
  (zero dependencies, works inside compiled binaries — documented feature). The
  entire ledger is **one file** the user can see, copy, and back up — the strongest
  possible expression of the portability principle. SQLite is public domain,
  everywhere, and will outlive us all.
- **The cost: a schema/dialect migration.** Drizzle's `sqlite-core` is a different
  schema definition:
  | Postgres today | SQLite equivalent | Notes |
  |---|---|---|
  | `numeric(12,2)` (string) | `text` | Convention already "treat as strings" — arithmetic already happens in JS/SQL `SUM` — audit every `SUM`/`CAST`; SQLite sums of text need `CAST(amount AS NUMERIC)` care or a decimal helper |
  | `uuid` `defaultRandom()` | `text` + app-side `crypto.randomUUID()` | |
  | `timestamp` | `integer` (unix ms, `mode: 'timestamp'`) | UTC convention preserved |
  | `jsonb` | `text` (`mode: 'json'`) | `preferences`, `columnMapping` |
  | `boolean` | `integer` (`mode: 'boolean'`) | |
- Raw SQL fragments and Postgres-isms (`ILIKE`, `now()`, `numeric` casts) need a
  sweep — grep-able, bounded work, but real.
- **If Track A (cloud) also ships**, we maintain *two* schema files and run CI on
  both dialects. Drizzle makes this tractable (shared column shapes via helpers) but
  it is a permanent tax. If the local track *wins outright*, cloud Postgres could
  even migrate to server-side SQLite (Litestream replication) — many small SaaS run
  fine on it — collapsing back to one dialect.

## Recommendation

**SQLite, with eyes open.** Reasons, in order: (1) the one-file user-owned data
story is a *product feature* in this track, not an implementation detail; (2)
`bun:sqlite` inside a compiled binary is a supported, documented path — PGlite inside
one is an experiment; (3) betting the durability layer on WASM-Postgres is the wrong
place for novelty in a finance app. Run the P1 spike with both anyway — it's a day —
and let PGlite falsify this if it shines.

Amounts stay **text strings** end-to-end (matching the existing convention), with a
single shared decimal-math helper module and a lint rule against arithmetic on raw
amount fields.

## File layout & lifecycle (user-owned data as a feature)

- **Locations:** platform-standard app-data dirs (XDG `~/.local/share/havefish/`,
  `~/Library/Application Support/havefish/`, `%APPDATA%\havefish\`), containing
  `havefish.sqlite` (+ WAL), `config.json`, `backups/`, `logs/`. A "Show my data
  file" menu item — transparency is the pitch.
- **Journal mode WAL**, `synchronous=NORMAL`, foreign keys ON; checkpoint on quit
  (L01 shutdown hook).
- **Automatic local backups:** on every launch (and daily while running), copy via
  SQLite Online Backup API into `backups/`, rotate (e.g. 7 daily / 8 weekly / 12
  monthly). Backup **restore is a first-run UI path** ("Restore from backup…"), not
  a support incident. This replaces the entire cloud-track backup apparatus — the
  user's disk is the failure domain, and we should say so plainly in-app and
  encourage the user's own cloud-drive/Time Machine coverage of the data dir.
- **hledger export** remains the cross-tool escape hatch and gets *more* prominent
  (menu-level), since it doubles as a human-auditable backup format.
- **Import from hosted instance:** a migration path (Track A ⇄ Track B) — export
  bundle (JSON or the journal + settings) from the server edition, import locally.
  Needed for the existing household deployment regardless of which track wins.

## Encryption at rest (open question — mirrors cloud-track Q2)

`bun:sqlite` has **no SQLCipher support**. Options:
1. **Rely on OS disk encryption** (FileVault/BitLocker/LUKS) + app-data dir
  permissions. Recommendation for v1 — same reasoning as cloud Q2: key management
  UX (forgotten passphrase = lost ledger, ironic for a backup-obsessed app) costs
  more than the marginal threat coverage.
2. Optional passphrase mode later: swap driver to `better-sqlite3-multiple-ciphers`
  (Bun runs many Node native modules; needs verification) or libsql variants.
  Track as **LQ2** in PROGRESS.
3. Never encrypt the *backups* differently from the DB — consistency or nothing.

## Migrations in a shipped binary

Drizzle migrations (SQL files) get **embedded in the binary** and applied on startup
inside a transaction, with an automatic pre-migration backup copy (cheap with
one-file SQLite — this is a straight upgrade over the cloud story). Version-stamp the
DB; refuse to open a *newer* DB with an older binary with a clear message (the
downgrade-after-auto-update trap).

## Test suite impact

`clearDatabase()` and the route tests port to SQLite naturally; in-memory
`:memory:` SQLite makes the suite dramatically faster. CI matrix runs both dialects
while both tracks live (L01).

## Phased work breakdown

**Phase D1 (with L01 P1 spike):** SQLite + PGlite bake-off on 3–4 representative
routes incl. a report aggregation; verify both inside a compiled binary.
**Phase D2 (≈2–3 wks):** full schema translation, decimal helper, raw-SQL sweep,
migration embedding + startup runner, dual-dialect CI.
**Phase D3 (≈1–2 wks):** data-dir layout, WAL config, backup rotation + restore UI,
export/import bundle for Track A ⇄ B migration.

## Sources

- [Drizzle ORM — SQLite (bun:sqlite)](https://orm.drizzle.team/docs/connect-bun-sqlite), [column types for SQLite](https://orm.drizzle.team/docs/column-types/sqlite)
- [Bun — bun:sqlite docs](https://bun.com/docs/api/sqlite) (built-in driver; usable in compiled executables)
- [Drizzle ORM — PGlite driver](https://orm.drizzle.team/docs/connect-pglite); [PGlite docs](https://pglite.dev/) (WASM Postgres, single-connection, fs persistence); [PGlite ORM support](https://pglite.dev/docs/orm-support)
- [SQLite — Online Backup API](https://www.sqlite.org/backup.html), [WAL mode](https://www.sqlite.org/wal.html), [Appropriate Uses](https://www.sqlite.org/whentouse.html)
- [Litestream](https://litestream.io/) (if server-side SQLite ever consolidates the dialects)
- [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) (encryption option, LQ2)
