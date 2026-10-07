# backend/: the current app's server

These are the current app's rules. Claude Code loads this file when a session first reads a file
under `backend/`. The rewrite (`core/`, `desktop/`) does not follow them; the root `CLAUDE.md`
has its rules. The current app is in maintenance: fixes and work already in flight land here, and
new features go into the rewrite unless the owner says otherwise.

`ARCHITECTURE.md` is the map: request flow, layers, every write path, and "Two editions, one
app".

## Stack

- **Server**: Hono + Bun (TypeScript)
- **Database**: PostgreSQL (server build) or SQLite through libsql (local build, D8), via Drizzle ORM
- **Auth**: Better Auth (email + password)
- **Deployment**: Docker/Podman Compose

## Structure

```
backend/
├── ARCHITECTURE.md      # Map of the backend: request flow, layers, every write path
├── src/
│   ├── app.ts           # Hono app (import this in tests)
│   ├── index.ts         # Bun server entry point (do not import in tests)
│   ├── build-app.ts     # The routes behind an edge: server-edge.ts or local/edge.ts
│   ├── db/
│   │   ├── schema.ts    # The tables, re-exported from this build's dialect
│   │   ├── index.ts     # The client, likewise (ARCHITECTURE.md, "Two builds")
│   │   ├── pg/          # Postgres client + schema.ts (the server build)
│   │   └── sqlite/      # SQLite client + schema.ts (the local build, --conditions=sqlite)
│   ├── accounts/, import/, rules/, …
│   │                    # One folder per domain: its services and pure rules, with their tests
│   ├── local/           # The local build: launcher, lockfile, launch token, profile, binary entry
│   ├── routes/          # One file per resource, co-located with tests
│   └── test-utils.ts    # clearDatabase(), createTestUser(), at() and request() for tests
└── drizzle/             # Generated migration files (do not edit by hand)
```

## Commands

```bash
# From backend/
bun run dev           # start dev server with hot reload
bun run local         # the local build: builds the frontend, then opens it signed in (#287)
bun run build:binary  # the local build as one file, dist/havefish, frontend and migrations inside (#288)
                      # a vX.Y.Z tag releases it for linux-x64 and arm64 (release-desktop.yml, #335)
bun run export:local --email <address> --out <file>
                      # inside the hosted container: one person's ledger as a local file (#289)
                      # then, on the laptop: `havefish --adopt <file>` makes it that install's ledger
bun test              # run all tests (the hledger export test skips unless `hledger` is installed)
bun run test:sqlite   # the same suite on SQLite, in a temp file it creates and migrates
bun run test:watch    # run tests in watch mode (use while developing)
bun run check         # the type checker, on both dialects; CI runs it
bun run lint          # Biome, scoped to backend/ (root CLAUDE.md, "Formatting and linting")
bun run db:generate       # generate SQL migrations from schema changes, for both dialects
bun run db:migrate        # apply migrations to the dev database
bun run db:migrate:test   # apply migrations to the test database
bun run db:migrate:sqlite # apply the SQLite migrations to the file SQLITE_PATH names (the app's own migrator)
bun run db:studio         # open Drizzle Studio (DB GUI in browser)

# From the project root
podman compose up postgres -d     # start just Postgres locally
podman compose up --build         # start full stack
```

`tsconfig.json` turns on the strictness flags that `strict` does not imply —
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`,
`noImplicitOverride` and `verbatimModuleSyntax` — each with a comment saying what it buys.
`bun run check` is the gate; CI runs it, and nothing under `src` is excluded from it — the test
files included. A test reads a response through `at()` and sends one through `request()`, both
from `test-utils.ts`: the first says out loud that a list came back non-empty, the second is
`app.request` typed as the promise it always returns.

## Development workflow

- Write tests first in `*.test.ts` co-located with the route file
- Tests use `app.request()` (Hono's test helper) against a real database — no mocking
- Always run `clearDatabase()` in `beforeEach` to keep tests isolated
- Tests run against `havefish_test` (set via `TEST_DATABASE_URL`); the dev database (`havefish`) is never touched by the test suite
- A schema change is made in **both** `db/pg/schema.ts` and `db/sqlite/schema.ts` (`db/schemas.test.ts` fails until they match), then `db:generate`, then `db:migrate` and `db:migrate:test`
- Run `bun run test:sqlite` as well as `bun test` for anything that touches the database; CI runs both

Every test run is offline: `bunfig.toml` preloads a `fetch` that throws for anything past
loopback, and `network.test.ts` lists the only files allowed to reach the network.

## Environment

Copy `.env.example` to `.env` in this directory for local dev:
```
DATABASE_URL=postgres://havefish:havefish@localhost:5432/havefish
TEST_DATABASE_URL=postgres://havefish:havefish@localhost:5432/havefish_test
PORT=8887
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:8887
FRONTEND_URL=http://localhost:8888
TRUSTED_ORIGINS=      # optional; extra origins allowed to authenticate, such as the mobile app's server URL
LOG_LEVEL=            # optional; debug in dev, info in prod and the local build, silent under test
SQLITE_PATH=havefish.sqlite  # the SQLite build's database file; the Postgres build ignores it
HAVEFISH_MODE=        # unset or `server` for the hosted edition; `local` for the local build
```

`DATABASE_URL` is the dev database. `TEST_DATABASE_URL` is a separate database used exclusively
by the test suite — `bun test` sets `NODE_ENV=test` automatically, which makes the DB client pick
`TEST_DATABASE_URL` instead. The test database must be created and migrated once:
`bun run db:migrate:test`.

The local build (`bun run local`, or `HAVEFISH_MODE=local` with `--conditions=sqlite`) ignores
`SQLITE_PATH`, `PORT` and the Better Auth variables. It keeps its data in
`$XDG_DATA_HOME/havefish` (`HAVEFISH_DATA_DIR` overrides it), listens on 127.0.0.1 from port
47821 (`HAVEFISH_PORT`), and opens the browser unless `HAVEFISH_NO_BROWSER` is set, in which
case it prints the link. `bun run build:binary` compiles the same thing into `dist/havefish`,
one file with the frontend and migrations inside; the binary copies the database into the data
directory's `backups/` before any migration and refuses a file a newer build migrated. The local
build logs to `havefish.log` in the data directory, not the terminal, at `info` unless `LOG_LEVEL`
says otherwise; past 5 MB it is kept as `havefish.log.1` at the next start. The binary's first
launch adds `havefish.desktop` and its icon under `$XDG_DATA_HOME` so it is in the applications
menu, and does not put the entry back once it has been deleted.
`ARCHITECTURE.md`, "Two editions, one app", has the rest.

## The backend writes no sentences

A route answers a failed request with a code and the values that vary —
`fail(c, 'FIELD_REQUIRED', { field: 'name' })` sends
`{ error: 'FIELD_REQUIRED', detail: { field: 'name' } }` — and the frontend's `copy/errors.ts`
owns the words. `fail` and `failWith` are in `src/respond.ts`; a service decides a failure
with `errorBody` and hands it back as an `Outcome`. Add a failure by adding the code and its
status to `src/errors.ts` and the sentence to `frontend/src/lib/copy/errors.ts`; the status
lives in the registry so one failure cannot answer 400 in one route and 404 in another. Two
tests hold it: a written-out `error: '…'` anywhere under `src` fails `errors.test.ts`, and a
code with no sentence (or a sentence with no code) fails `frontend/src/lib/copy/errors.test.ts`.

## It trusts no body

A route parses its request body through a Zod schema declared beside the handler, via
`parseBody(c, Schema)` from `src/validation.ts` — never `c.req.json()`, which is a cast over a
value nothing has looked at. `bodies.test.ts` fails if one comes back. `validation.ts` maps
what the schema rejects onto the codes in `errors.ts`, so a validator still never writes a
sentence; `as`, `asField` and `asInput` are how one check overrides that mapping to keep the
code a route already answered with. Where a route's own domain check produces a better failure
than a schema could (`ACCOUNT_PATH_INVALID`, `UNSUPPORTED_CURRENCY`), the schema types the
field `unknown` and the check stays.

## It keeps three layers

A route parses the request, reads `userId`, calls a service and answers. A service
(`*-service.ts`) loads what a rule needs, runs it and writes; it is the only kind of file that
touches the database, and the one that owns a unit of work opens its transaction. A domain
module is a pure rule that a phone could run against its own SQLite file: it imports only other
domain modules and an allowlist of packages, so never the database client, the schema, Drizzle
or Hono, not even for a type. `*-sql.ts` builds query fragments for services and runs none.
`src/layers.test.ts` gives every file a layer from its name (anything unnamed is domain) and
fails on the first import across the line; the eight `fish-pie-*` routes are exempt until they
leave under #380. Its queries say nothing only Postgres understands, so the SQLite port swaps a
driver rather than rewriting them: `src/dialect.test.ts` refuses `db.execute`, `sql.raw`, and a
`::` cast, `to_char`, `jsonb` or `SUM(` inside a `sql` template.

## It says only what `RequestLog` allows

One structured JSON line per request, via `logRequest` in `src/logging.ts`. `RequestLog` is the
whole vocabulary of that line, and `logRequest` copies its fields by name rather than spreading
what it was handed, so a request body cannot reach the log — there is nowhere to put one. Adding
a field means editing that type, in a diff that can be reviewed for exactly this. Redaction of
`authorization`, `cookie`, `password`, `token`, `secret`, `payload`, `blob` and `body` is the
second line, for the error paths and library output that do not come through the wrapper. `log`
from the same file is for everything that is not a request; `console.log` is for scripts under
`scripts/`, never for anything a request can reach.

## Conventions

- Amounts stored as `numeric(12,2)` strings in Postgres — treat as strings, not floats
- UUIDs as primary keys throughout
- Negative amounts = expenses, positive = income
- All timestamps stored in UTC
- Default currency is CAD
- Soft deletes — records are never hard deleted. Use `deletedAt` timestamp; `null` means active. Query active records by filtering `deletedAt IS NULL`.
- Drizzle returns an array from every query, so under `noUncheckedIndexedAccess` the first
  element is `Row | undefined`. When the statement itself guarantees the row — an insert, or
  an update to a row the same transaction just wrote — read it with
  `returnedRow(rows, 'insert accounts')` from `src/db/returning.ts`, which throws
  naming the statement. When the row may legitimately be missing, that is a 404:
  `const [row] = await …; if (!row) return fail(c, 'ACCOUNT_NOT_FOUND')`. Never `!`: it
  deletes the question rather than answering it.
- A guard narrows `body.field`, but that narrowing does not survive into a
  `db.transaction(async (tx) => …)` callback. Read the checked value into a local right
  after the guard rather than re-asserting it inside.
- A parsed body holds only the keys its schema names, so spread it into an insert or an
  update rather than copying field by field. Drizzle refuses a key that might be present
  and `undefined`; `defined()` from `validation.ts` states what parsing already guarantees.
