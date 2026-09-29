# Backend architecture

A map of `backend/src`, for someone who knows backends but not this one. It describes the
code as it is on `main` (last updated by #431), and the layering the [domain-layer
epic](../planning/epics/archive/domain-layer.md) (#423) moved it to. Each story of that
epic updates this file in the same PR, so it should never describe code that no longer
exists.

## How a request flows

```
index.ts        Bun entry point: reads HAVEFISH_MODE once, then PORT and the static root
  └ server.ts   one Hono server: the API first, then the built frontend, then the SPA fallback
      └ build-app.ts  the API: edge guard → request logger → session guard → route
          └ routes/<resource>.ts   parse the request, call one service, answer
              ├ services            *-service.ts: load, check, write (ledger/write-service, …)
              ├ pure modules        ledger/validate, import/, postings/, coverage/ … (no database)
              └ db/                 Drizzle client and schema: db/pg/ or db/sqlite/, per build
```

- **The session guard** is in `build-app.ts`, and the edge decides what a session is (see
  "Two editions, one app" below). In the server build every `/api/*` path except
  `/api/auth/*` and `/api/capabilities` needs a Better Auth session; the guard puts `userId`
  on the context. A route reads it with `c.get('userId')`, and every query it runs is
  expected to scope by it.
- **Request bodies** are parsed through a Zod schema declared beside the handler, via
  `parseBody(c, Schema)` in `validation.ts`. `bodies.test.ts` holds the rule. The eight
  `fish-pie-*` route files are exempt because they leave this repository under #380.
- **Failures** are a code plus the values that vary: `fail(c, 'ACCOUNT_NOT_FOUND')`. The
  codes and their HTTP status live in `errors.ts`, which imports nothing, so a pure module can
  name a failure; `fail` and `failWith`, which need a request, live in `respond.ts`. The
  sentences live in the frontend's `copy/errors.ts`.
- **Logging** is one structured line per request, from `request-log.ts` and `logging.ts`.
  A request body has no field to land in.
- **Unhandled throws** reach `app.onError`, which logs the message and the stack, and
  answers a plain 500.

## The words you need

| Term | Means |
|---|---|
| Transaction | A dated envelope with a description. It holds no money itself |
| Posting | One leg: an account, a signed amount, a currency. A transaction's postings sum to zero **per currency** |
| Account path | `assets:bank:chequing`. Colon-separated, and materialized on every row, so a parent with no row of its own is a virtual grouping node |
| Account type | What an account *is*: asset, liability, equity, income or expense, plus cash and conversion. The stored override wins, then a tagged ancestor's type, then inference from the path root. `postings/account-type.ts` |
| Posting role | The job one leg does inside one transaction: subject, transfer, conversion, fee or share. `postings/roles.ts` |
| Conversion account | `equity:conversions`. It bridges two currencies, so a cross-currency transaction balances per currency without anyone knowing a rate |
| Clearing account | `assets:receivable:<group>`, one per member per Fish Pie group. It nets what the group owes you against what you owe it. System-managed |
| Coverage | "This account's ledger is complete from A through B." Append-only assertions, merged into spans on read |

## Layers

| Layer | Does | May import | Files |
|---|---|---|---|
| Route | Parse, read `userId`, call a service, shape the answer | Services, domain modules, `validation`, `respond`, `errors` | `routes/*.ts`. None of the personal-ledger routes touches `db` since #429. The eight `fish-pie-*` routes still do; they leave under #380, and #430 took only their maths |
| Service | Load, check, write inside one transaction | Anything but a route | Every `*-service.ts`: `ledger/{write,read}-service`, `import/{preview,duplicates,commit,parser}-service`, `accounts/{account,balance,action-required,ownership}-service`, `postings/{heal,classify,spend}-service`, `coverage/{coverage,config,load}-service`, `settings/settings-service`, `rules/rule-service`, `reports/report-service`, `fx/rate-service`, `export/export-service`, `fish-pie-{expense,accounts}-service` |
| Domain | Pure rules | Other domain modules, and `papaparse` and `@noble/hashes` | Everything else: `errors`, `money`, `currencies`, `calendar-date`, `ledger/validate`, `import/*`, `accounts/{paths,balances}`, `postings/{account-type,roles,heal}`, `coverage/{intervals,months,catch-up,horizon,reconcile}`, `rules/{target,mining}`, `reports/spending`, `settings/preferences`, `fish-pie/{splits,legs,balances,clearing}`, `export/journal` |

Two more kinds of file sit beside them:

- **Query fragments** (`*-sql.ts`; only `postings/account-type-sql.ts` today). These build
  `WHERE` clauses for services. They need the schema to name columns but run no query, and
  only services import them.
- **Infrastructure**: `index`, `server`, `app`, `build-app`, `server-edge`, `auth`,
  `logging`, `request-log`, `validation`, `respond`, `test-utils`, `test-network-off`,
  `db/{index,schema,returning}`, the two dialect folders `db/pg/` and `db/sqlite/`, the local
  build's `local/{edge,launch,launch-token,lockfile,data-dir}`, and `fx/rate-source.ts`. The
  last holds the backend's only outbound `fetch` (frankfurter.app). It touches no database,
  so an offline build or a test has one function to stub.

**How the layers are held** (`layers.test.ts`, #431). Every source file gets its layer from
its name: `routes/`, `-service.ts`, `-sql.ts`, the infrastructure list, and anything else is
domain. A new file is therefore held to the strictest rule until its name says otherwise.
The test reads every import with TypeScript's own scanner, type-only imports and re-exports
included, and fails when:

- a domain module imports anything but another domain module or an allowlisted package.
  Checking each import is enough for the whole graph, since everything a domain module
  reaches is then domain too. No domain module reaches `db`, the schema, Drizzle or Hono,
  even for a type. That is why `fail` and `failWith` left `errors.ts`;
- a domain module calls `fetch`;
- anything but a service, infrastructure or a leaving Fish Pie route imports the database
  client;
- a `*-sql.ts` file imports the client, or is imported by anything but a service;
- a route that stays imports `db`, the schema or Drizzle, or opens a transaction
  (`db.transaction` or `inLedgerTransaction`).

The Fish Pie exemption can only shrink. The test fails if a name on it no longer matches a
file, or matches one that no longer needs it. The package allowlist is `papaparse` and
`@noble/hashes`, the pure-JS hashes the import fingerprint uses so a phone mints the same
keys as the server (#474). `ledger/writers.test.ts` keeps
the ledger write service the only writer of postings, and `routes/bodies.test.ts` keeps
every staying route parsing its body through a schema.

**How the queries stay dialect-neutral** (`dialect.test.ts`, #280). Every query goes through
the query builder: no `db.execute`, which Drizzle's SQLite driver does not have, and no
`sql.raw`. Inside a `sql` template the test refuses a `::` cast, `to_char`, `jsonb` and
`SUM(`, and points at what replaced each one: Drizzle's `count()` and `countDistinct()`,
text dates (#277), JSON merged in TypeScript (#278) and `money.sum` (#279). The dialect
folders, `db/pg/` and `db/sqlite/`, are the only code allowed to speak one dialect.

**Two builds, one set of queries** (#482). `db/index.ts` and `db/schema.ts` re-export
`#dialect/client` and `#dialect/schema`, a package.json `imports` entry that a build condition
resolves: `db/pg/` by default, `db/sqlite/` under `--conditions=sqlite` (`bun run test:sqlite`,
and the local binary). It is chosen when the process starts, not by an environment variable,
and that is what lets tsc check it: `bun run check` runs tsc once per dialect
(`tsconfig.check.json`, `tsconfig.check.sqlite.json`), so every service is typed against the
real client and schema of each build, with no cast between them. The two schemas declare the
same tables, columns, indexes, checks and foreign keys, and `db/schemas.test.ts` compares them
through Drizzle's table configs. Only the column types differ, per L02: uuid → text with
`randomUUID`, numeric → text, timestamp → integer ms, jsonb → JSON text, boolean → integer.
Where the dialects must behave differently, the difference is exported from both clients:
`dialect` (Better Auth's provider) and `forUpdate` (below). Each has its own migrations,
`drizzle/` and `drizzle/sqlite/`; `db:generate` writes both.

**One writer at a time on SQLite** (`db/sqlite/client.ts`). libsql begins a transaction
IMMEDIATE, taking SQLite's one write lock until it ends. Every connection lives on the one
thread, so a second writer cannot wait for it (a busy timeout would block the thread the
first needs to finish) and fails with SQLITE_BUSY instead (#285). So writes take turns
in-process: `db.transaction` and every non-`SELECT` statement outside a transaction wait for
the one before. Reads go straight through, which WAL allows. A write through `db` from inside
a transaction's callback would wait for its own transaction forever, so it throws, naming
`tx`. `db/transactions.test.ts` starts twelve transactions in one tick on both dialects.

**Two editions, one app** (#287, D7). `HAVEFISH_MODE` is read once, in `index.ts`: unset
or `server` is the hosted edition, `local` the app on one person's machine. The routes and
services are the same code in both; `buildApp(edge)` mounts them behind an `Edge`, which is
everything that differs:

| | `server-edge.ts` | `local/edge.ts` |
|---|---|---|
| Before everything | CORS for the dev frontend and the phone | Refuses a `Host` other than `127.0.0.1:<port>`, and a cross-site or same-site request (DNS rebinding, other pages, other local ports). No CORS headers at all |
| A session is | Better Auth's | The cookie bought with a single-use launch token; every session is the local profile |
| Open without one | `/api/auth/*`, `/api/capabilities` | `/api/local/session` (the exchange), `/api/auth/get-session`, `/api/capabilities` |
| Fish Pie | Mounted | Absent, not refused (D3) |

`GET /api/capabilities` says which it is, so the frontend hides Fish Pie, sign-out and the
account controls in the local build. `app.ts` is the server build's app, the one the tests
import; the local launcher never loads it, so it never constructs Better Auth.

The local edge answers `GET /api/auth/get-session` itself, in the shape Better Auth's client
reads, so the frontend's session handling is the same code in both builds. It is the one
Better Auth path the local build knows.

**Starting the local build** (`local/launch.ts`). `bun run local`, or `HAVEFISH_MODE=local`
with `--conditions=sqlite`, or the compiled binary (below); the Postgres build refuses the
mode. In order:

1. The data directory is `$XDG_DATA_HOME/havefish` (`HAVEFISH_DATA_DIR` overrides it), made
   `0700`. It holds `havefish.sqlite`, `havefish.lock` and `backups/`.
2. The lock is created exclusively and names the process holding it. A second launch finds a
   live holder, signs a fresh launch link with the key the holder published in the lockfile,
   opens it and exits: one process per database file, since the write queue above is
   per-process. A lock left by a dead process is taken over.
3. `SQLITE_PATH` is set, and only then is anything that touches the database imported. The
   file is migrated (below), and the local profile found or minted
   (`local/profile-service.ts`): one `user` row, the starter accounts and settings a sign-up
   gives (`users/starter-service.ts`), and the `local_profile` row that says whose file it is.
4. It binds `127.0.0.1` on the first free port from 47821 (`HAVEFISH_PORT` overrides it),
   publishes the port and a fresh launch key in the lockfile, and opens the browser at
   `/#token=…`. The fragment is never sent, so the token never reaches a request line or a
   log. The page trades it for an `HttpOnly`, `SameSite=Strict` cookie whose value lives only
   in this process: a restart ends every session, and the launcher opens a new one.

A launch token is `<issued>.<nonce>.<HMAC>`, good once and for two minutes
(`local/launch-token.ts`). SIGINT or SIGTERM lets requests in flight finish (two seconds at
most), checkpoints the WAL into the file, closes it, and only then removes the lock.

**Migrating a SQLite file** (`db/sqlite/migrate.ts`, #288). Not drizzle's migrator, which reads
a folder at run time: this one is handed the migrations as a list of `{tag, statements}`, so
a binary can carry them as strings. It records each applied tag in `__migrations`, and applies
what is missing in one transaction with foreign keys off. Before it writes to a file that
already holds migrations, it copies it to `backups/pre-migrate-<time>.sqlite` with
`VACUUM INTO`, which includes what is still in the WAL. A file that records a tag this build
does not know was opened by a newer one, and is refused before anything is written or copied.
A file #287's launcher migrated with drizzle's migrator is adopted by matching
`__drizzle_migrations`' timestamps to the journal. The launcher, the SQLite test run and
`db:migrate:sqlite` all use it; `db:generate` still writes the files.

**The binary** (`bun run build:binary`, `scripts/build-binary.ts`, #288). One executable for
linux-x64 or linux-arm64 (`--target`, this machine's by default), about 107 MB, nearly all of
it the Bun runtime. The script writes `dist/entry.ts`
(`local/embed.ts`), which imports every file of `frontend/build` by name `with { type: 'file' }`
rather than embedding the directory (Bun has dropped files from embedded directories), carries
the migrations as strings, and calls `launchLocal` with both. `server.ts` serves those files
by exact path in place of `serveStatic`. The compile runs with `--conditions=sqlite` and one
plugin: libsql loads its native addon with a computed `require` the bundler cannot follow, so
the plugin rewrites it to a static require of the target's addon (`@libsql/linux-x64-gnu` or
`linux-arm64-gnu`), and the addon is embedded like any other file (#284). `bun install` fetches
only this machine's addon, so a target is built on its own architecture. `PUBLIC_VERSION` is
stamped in, and `havefish --version` prints it without opening the data directory. CI's
`local-binary` job builds it and starts it twice (`local/binary.test.ts`).

**Releasing it** (`.github/workflows/release-desktop.yml`, #335). A tag `vX.Y.Z` (plain `v`;
the APK's are `android-v*`, #493) builds both targets on their own runners with
`PUBLIC_VERSION=X.Y.Z`, runs `binary.test.ts` against each with the version it must print, and
publishes `havefish-linux-x64`, `havefish-linux-arm64` and `SHA256SUMS` as a GitHub Release. A
tag with a `-` in it is a pre-release. Run by hand, the workflow builds and tests without
publishing.

**Leaving the hosted edition** (#289, #508). The two people on hosted each move over once:
- `bun run export:local --email … --out …` runs inside the hosted container. `local/hosted-export-service.ts` reads that person's rows from Postgres and writes them into a fresh SQLite file made by the migrator above, ids unchanged, with the `local_profile` row pointing at their hosted user. It carries the ledger, the parsers, the rules, the settings, the coverage and the FX cache. It leaves Fish Pie behind: a rule that splits into a group is dropped, and a transaction's `groupExpenseId` is cleared.
- The file is written as `<out>.partial` and renamed only after three checks pass: every table holds as many rows as were read, `PRAGMA foreign_key_check` finds nothing, and every account's balance per currency matches.
- `havefish --adopt <file>` (`local/adopt-service.ts`) runs under the data directory's lock, before the database is opened. It copies the file in beside the ledger, migrates it and checks that it has exactly one owner. It refuses while another instance runs, and when the ledger already there has transactions. The old file goes to `backups/pre-adopt-<time>.sqlite`, and its WAL is removed so it can't replay into the new one. `db/sqlite/files.ts` holds the SQLite file operations both steps use.

**No hidden network calls** (`network.test.ts`, `test-network-off.ts`). The personal ledger
works offline, and two things hold that. The static test lists the files allowed to open a
connection (`fetch`, `Bun.connect`, WebSocket, the node network modules): today only
`fx/rate-source.ts`, and in time `sync/` and the Fish Pie proxy. And `bunfig.toml` preloads
`test-network-off.ts` into every test run, on both dialects, which makes any call past
loopback throw. A dependency that quietly phones home fails the suite rather than the laptop.

The test for whether something belongs in a domain module: could a phone run it against its
own SQLite file, or a laptop run it on a document that just arrived from the relay?

## Route map

Mount points are in `app.ts`. "Rules" is where the checks that make a write correct
actually live; "writes" lists the tables touched.

### Personal ledger

**`accounts.ts`** — `/api/accounts` (208 lines). The handlers parse and answer; the work
is in `accounts/` (#428).

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `GET /` | Every active account, with its resolved type | `account-service` → `account-type` | — |
| `GET /balances` | Balance-bearing accounts with per-currency sums | `readBalanceSelection` and `selects` (`balances`), `balance-service` with `account-type-sql`; `sumByCurrency` | — |
| `GET /posting-counts` | Entries and last activity per account | `balance-service` (SQL) | — |
| `GET /:id/balance` | One account's balance as of a date | `balance-service`: `accountsOwnedBy`, `sumByCurrency` | — |
| `GET /action-required-summary` | Per account: uncategorized plus malformed-FX counts | `action-required-service` + `heal-service` | — |
| `GET /:id/action-required` | The same, for one account, with ids | Same, after `accountsOwnedBy` | — |
| `GET /:id` | One account with resolved, inferred and inherited type | `account-service` → `explainType` | — |
| `POST /` | Create an account | Schema: path shape (`isValidPath`); `account-service`: not in the receivable namespace, not taken ignoring case (`pathTakenBy`) | `accounts` |
| `POST /rename` | Rewrite a path prefix across a subtree | `planRename` (`paths`): same path, valid target, receivable namespace, no match, collision ignoring case; `account-service` writes it in one transaction | `accounts` |
| `PATCH /:id` | Name, currency, type override | Schema | `accounts` |
| `DELETE /:id` | Soft-delete one nothing depends on | `account-service`: no entries, not a default, not receivable | `accounts` |

**How the rename works.** Paths are materialized: every account row holds its whole path,
and a parent with no row of its own exists only as a prefix of its children's paths. So
renaming `expenses:food` to `expenses:eating` rewrites the prefix on every row at or under
it, and a virtual parent renames by way of its children. `planRename` gets the user's active
accounts and returns the new path for each moved row, or the failure. It matches in code
rather than with SQL `LIKE`, so `_` and `%` in a path are plain characters, and the match is
anchored on the colon, so `expenses:foodcourt` stays put. A new path already held by an
account *outside* the moved subtree is refused, since that would be a merge; one held
*inside* it is fine, because that row moves too. Postings don't change: they point at
`accounts.id`, which a rename never touches.

**Paths ignore case (#480).** A path keeps the spelling it was typed with, and
`accounts.path_key` holds it in the form paths are compared in (`pathKey` in `paths.ts`,
computed in TypeScript because SQLite's `lower()` is ASCII-only). Every lookup by path and
every "at or under" (`underPathCondition`) goes through the key. Create and rename refuse a
path whose key is taken, and one that spells an existing tree node differently
(`pathTakenBy`): with `assets:wise` there, `assets:Wise:eur` would be a second subtree on
screen but the same one to a query by key. A partial unique index on
`(user_id, path_key) WHERE deleted_at IS NULL` backs the first rule; the second is the
service's alone, and `bun run check:account-paths` checks a database against both.

**`transactions.ts`** — `/api/transactions` (235 lines). Writes go through
`ledger/write-service` and reads through `ledger/read-service`; the handlers parse and
shape the answer.

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `GET /malformed-fx-spend` | Malformed cross-currency spends, before and after | `malformedFxSpendReport` (`heal-service`) → `previewRepair` (`heal`) | — |
| `GET /` | Transactions with postings and roles; filters by account, path, dates, spending | `listTransactions` (`read-service`) + `roles`, `spend-service` | — |
| `POST /` | Create one transaction | `createTransaction`: `validatePostings`, then ownership | `transactions`, `postings` |
| `POST /bulk` | Create many, atomically | `createTransactions`: the same, with each entry's index | Same |
| `PATCH /:id` | Date and description | Schema; `updateTransactionDetails`: the caller's own, active transaction | `transactions` |
| `POST /:id/postings` | Replace every posting, atomically | `replacePostings`: the same, and the transaction is the caller's | `postings` (hard delete + insert) |
| `POST /:id/heal-fx-spend` | Repair one malformed spend | `heal-service` → `heal` | `postings` |
| `DELETE /:id` | Soft-delete the transaction | `deleteTransaction`: the caller's own, active transaction; its postings go only if that matched | `transactions`, `postings` (hard delete) |

There is no endpoint that edits one posting. A transaction's legs change as a set,
through `POST /api/transactions/:id/postings`, which is what lets the balance be checked
(#432 retired `/api/postings`).

**`import.ts`** — `/api/import` (157 lines). Each handler parses the request and calls one
service in `import/`; each service loads what a pure module needs and calls it.

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `POST /preview` | Match the CSV to a saved parser, parse it, suggest accounts from rules | `preview-service` → `preview` (`matchParser`, `suggest`), `csv-parser`, `dynamic-parser`, `merchant` | — |
| `POST /check-duplicates` | Possible duplicates per row, with Fish Pie context; a row already imported comes back `certain` | `duplicates-service` → `duplicates` (`findDuplicate`: ±1 day, same currency, amount within 0.01) and `fingerprint` | — |
| `POST /commit` | Write every row not already imported, and create Fish Pie expenses for split rows | `commit-service`: split checks, `checkRows`, `accountsOwnedBy`, `identify` and the skip, then `planRows` inside `inLedgerTransaction`; `writeTransaction` validates each row | `transactions`, `postings`, Fish Pie tables |

**How an import commit works.** The plan (`import/commit-plan.ts`) is two pure functions:

- `checkRows`: does each row name the accounts its kind needs? A Fish Pie split needs
  fewer, because the group's clearing account and the payer's expense account replace
  the offset or target. The first row missing one is the answer.
- `planRows`: the transaction each row becomes. Its legs come from `import/postings.ts`,
  and a split row also carries the group expense to create.

The service (`import/commit-service.ts`) does everything the plan can't:

1. Check each split: row in range, the group exists, the caller is a member, the category
   is active.
2. `checkRows`, then check every named account is the caller's.
3. Open one database transaction and find or create what each split row needs from Fish
   Pie.
4. Run `planRows`, and write each row with `writeTransaction` then its group expense.

A refusal anywhere in step 4 rolls back every row.

**Importing the same row twice** (#282, formula in #460). The preview gives every row a
*row key*: a hash of the parser, the row's kind, date, amounts, currencies, normalised
description, and its position among identical rows in the file (`import/fingerprint.ts`).
The review sends the key back. Commit binds it to the row's *statement account*
(`statementAccountId`: the account the money left, or for a same-currency transfer the one
that received it) to make the fingerprint, and the transaction's id is a UUIDv5 of that
fingerprint and the user. A fingerprint already in `transactions.import_fingerprint`,
deleted or not, means the row is skipped, not written, and a partial unique index on
`(user_id, import_fingerprint)` backs that up. `check-duplicates` runs the same lookup, so
the review shows the row as already imported and skipped. A row sent without its key is
written as a new transaction: that's a manual import, or a duplicate the user chose to
import anyway.

The key, the fingerprint and the id are all derived from what the transaction says. They
are a local convergence device: two devices importing the same row mint the same id. They
never leave the device in the clear, and a sync relay never gets them as a column (#375). `takesSplit` says which row kinds a
split changes; a cross-currency spend ignores its split, as it always has. Because the
plan is pure, a rule like "a split degrades to a plain expense when Fish Pie is
unreachable" (offline import, `00-direction.md`) is a change to `planRows`, not to the
route.

**`rules.ts`** — `/api/rules` (105 lines). Import rules: a pattern that suggests an
account, or a Fish Pie group and category. The work is in `rules/` (#429).

| Endpoint | Does | Rules |
|---|---|---|
| `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` | List, create, edit, soft-delete | `readRuleTarget` (`target`): exactly one target, no category on an account; `rule-service`: the account is the caller's, the group one they're in, the category that group's and not archived |
| `POST /mine` | Suggest rules from history: merchant stems with one consistent expense account, seen twice or more | `mineSuggestions` (`mining`) + `merchant`, `roles` |
| `POST /:id/approve`, `/deny`, `/revive` | Move a rule between suggested, active and denied | `moveRule`: which moves exist and from which status |

**Smaller files**

| File | Mount | Does |
|---|---|---|
| `parsers.ts` | `/api/parsers` | CRUD for saved CSV parsers: header fingerprint, column mapping, default accounts (the caller's own). `import/parser-service` |
| `user-settings.ts` | `/api/user-settings` | The settings row: default accounts, type roots, preferred currency, a free-form `preferences` blob, shallow-merged. Reads and writes through `settings/settings-service` (`readSettings`, `updateSettings`) |
| `reports.ts` | `/api/reports` | The spending page's four reports: summary, monthly spend, FX pairs, converted totals. `reports/report-service` loads legs through `spend-service` and cached rates through `fx/rate-service`; `reports/spending` does the arithmetic |
| `fx-rates.ts` | `/api/fx-rates` | Rate for a date, or the latest within 7 days, cached in `fx_rates` by `fx/rate-service`. The fetch itself is `fx/rate-source`, and nothing but a `YYYY-MM-DD` date reaches its URL |
| `coverage.ts` | `/api/coverage`, plus `/api/accounts/:id/coverage` | Coverage assertions, per-account config (stored in `preferences.catchUp`), reconcile, month view. Handlers parse and answer; `coverage/coverage-service` does the work, `coverage/config-service` reads and writes the pins through `settings/settings-service`, and the rules are pure in `coverage/{horizon,intervals,months,reconcile}` (#428) |
| `catch-up.ts` | `/api/catch-up` | The catch-up coach's summary. `coverage/load-service` + `coverage/catch-up` |
| `export.ts` | `/api/export` | `GET /journal?from=&to=`: the ledger as an hledger `.journal` download. `export/export-service` loads it, `export/journal` writes it |

### Fish Pie

Eight files, about 2,100 lines, mounted under `/api/fish-pie`. They leave this repository
for the Fish Pie service under #380, so their orchestration was left as it is. The maths
they use stays here, because each member's device runs it, and since #430 it is pure, in
`fish-pie/`:

- `splits.ts`: dividing an expense by weight, with the cents left over going to the payer;
  when a category's weights apply (only if every member has one); explicit per-expense
  weights; the payer's share of an import-linked expense.
- `legs.ts`: the legs each member's own ledger gets. For an expense: the payer's payment,
  clearing and expense; everyone else's expense and debt. For a settlement: the payer's
  cash out and clearing credit, the receiver's cash in and clearing drain. For a batch: one
  cash leg per currency paid, a clearing leg per debt, and a conversion bridge for a debt
  paid in another currency; the receiver's side is the payer's with every sign flipped.
- `balances.ts`: each member's net position per currency, and the fewest transfers that
  settle it.

Every set of legs balances per currency, which `fish-pie/legs.test.ts` checks with the
ledger's own `imbalance`, and the ledger service checks again on every write.

| File | Does |
|---|---|
| `fish-pie-groups.ts` | Create, list, rename and delete groups; member settings (share weight, default accounts) |
| `fish-pie-invites.ts` | Invite by email, list, cancel, accept, decline |
| `fish-pie-categories.ts` | Categories per group: each member's private account mapping and the shared weight vector |
| `fish-pie-expenses.ts` | Create, list, edit and delete shared expenses. Every member's ledger transaction is rebuilt on edit. The edit handler alone is about 290 lines |
| `fish-pie-settlements.ts` | Settle up: one payment, or a batch across currencies. The receiver confirms. Two-sided ledger writes |
| `fish-pie-balances.ts`, `fish-pie-overview.ts` | Who owes whom, computed by `fish-pie/balances` |
| `fish-pie-merge.ts` | Merge several groups into one group with a category per source group |

A Fish Pie write touches more than the caller's own ledger. It creates or rebuilds
transactions for every member, and a settlement writes the payer's side, then the
receiver's side when they confirm. That's the part that becomes a protocol between devices
once the group is end-to-end encrypted (#393).

## Every write to `transactions` and `postings`

Every insert of either, and every update or delete of a posting, goes through
`ledger/write-service.ts`; `ledger/writers.test.ts` fails if one appears anywhere else. An
update to a transaction row itself is allowed anywhere, because the schema moves its
version (below) on its own.

| Caller | Through | Deletes postings by |
|---|---|---|
| `routes/transactions.ts` (create, bulk, replace, delete) | `createTransaction`, `createTransactions`, `replacePostings`, `deleteTransaction` | Hard delete (replace, delete) |
| `import/commit-service.ts` (`POST /api/import/commit`) | `writeTransaction`, one per row, in one `inLedgerTransaction` | — |
| `fish-pie-expense-service.ts` | `writeTransaction`, one per member | — |
| `routes/fish-pie-expenses.ts` | `inLedgerTransaction`; the payer's import transaction is rebalanced with `amendPostings`; edits and deletes use `retireTransactions` | Soft delete |
| `routes/fish-pie-settlements.ts` | `writeTransaction` for the payer's and receiver's sides, in `inLedgerTransaction`; delete uses `retireTransactions` | Soft delete |
| `postings/heal-service.ts` | `repointPostings`: moves the legs of a malformed spend, amounts untouched | — |
| `routes/fish-pie-merge.ts` | `moveAccountPostings`: folds old clearing accounts into the merged group's | — |

**The ledger write path** (`ledger/`). Every transaction is written in three steps, in this
order:

1. `validatePostings` (pure): at least two postings, supported currencies, every amount a
   number the column can hold, each currency summing to exactly zero in cents.
2. `accountsOwnedBy`: every account named belongs to the transaction's owner.
3. The inserts, inside one database transaction.

There are two ways in:

- **A whole request** (the transaction routes). The service opens the database transaction
  itself. Steps 1 and 2 run before it does, and a refusal is an `Outcome` the route sends
  with `failWith`. Accounts must be active.
- **A step in a larger unit of work** (import and Fish Pie). These build the legs
  themselves, inside a database transaction that also writes group expenses, settlements
  and clearing accounts:
  - The service or route that owns the unit opens it with `inLedgerTransaction`, and writes each
    transaction with `writeTransaction`, or with `amendPostings` to change some legs of an
    existing one.
  - A refusal from any of them rolls the whole unit back, and `inLedgerTransaction` hands it
    back as an `Outcome`, so the route still answers with `failWith` and never sees a throw.
  - An import refusal carries the row's `index`.
  - Accounts may be deleted but must be the owner's: Fish Pie builds legs from members'
    stored defaults, and whether those are still active is #443.

**Money** (`money.ts`). An amount goes in and comes out as the string `numeric(12,2)` stores,
and is added in integer cents in between. `money.parse` rounds a string to the cent
exactly as the column does on write (half away from zero), and answers null for anything
the column wouldn't store as money: not a number, `NaN`, or too large. Checking the
parsed cents is therefore checking what will be written, with no tolerance. Balances are
summed in JS rather than by SQL `SUM`, so the answer doesn't depend on the database's
decimal type; SQLite has none. For the same reason the ledger stores `format(cents(amount))`
rather than the string it was handed: Postgres would round and pad it on write, and a SQLite
text column keeps whatever it gets. `splitByWeights` is the one split rule: each share is
rounded to the cent, and the leftover goes to one named share.

**Dates** (`calendar-date.ts`, #277). `transactions.date` is a calendar day, `YYYY-MM-DD`
text, like the Fish Pie and FX dates. It never passes through a JS `Date` on its way in:
`writeTransaction` and its siblings store `calendarDateOf(draft.date)`, and a CSV cell is read
by `calendarDateFromText`, which keeps the day the bank wrote in any time zone. ISO text
compares correctly as a string, so every range filter, `MIN`, `MAX`, `GROUP BY` and `ORDER BY`
works on the column as it is, with no `::date` or `to_char`, in Postgres and SQLite alike.
Before, the column was a timestamp, and a backend running east of UTC stored a non-ISO CSV
date as the previous day (things-missed M1). `bun run test:zones`, which CI runs, repeats the
date-bearing suites in Tokyo and Los Angeles, because a date bug hides in UTC.

**Preferences** (`settings/`, #278). `userSettings.preferences` is one JSON blob with a key
per feature. Every change to it is worked out in JS (`preferences.ts`) and written back
whole by `writeSettings`, which locks the row between the read and the write so two
requests changing different keys at once both land. Postgres used to merge it with its
own JSON operators. The row lock is `forUpdate` from `db`: `FOR UPDATE` on Postgres, and
nothing on SQLite, where the transaction already holds the only write lock.

**The journal export** (`export/`, #283). Vision #2's escape hatch: `serializeJournal` writes
a `commodity` directive per currency, an `account` directive per account (typed `; type:X`
with the resolved type, bare when it has none), then every live transaction with its
postings exactly as stored, no `@` prices. hledger has no escaping, so `journalAccountName`
and `journalDescription` change the few characters its parser would misread: control
characters (a line break could start an `include`), whitespace runs in a path, a leading
bracket, a `;` in a description. `export/hledger.test.ts` is the acceptance test: it builds a
multi-currency ledger through the API, hands the export to a real hledger, and requires
`check --strict` to pass and every balance, date, description and type to match the app's.
It skips where hledger is missing; CI installs hledger and sets `REQUIRE_HLEDGER=1`.

**Deleting has two meanings.** A personal transaction's delete hard-deletes its postings.
A Fish Pie delete soft-deletes them. Postings are also hard-deleted and re-inserted with
new ids whenever a transaction's postings are replaced. That's why the transaction, not the
posting, is the unit that syncs (`planning/epics/sync-unit.md`).

**Versions.** Every sync document's root row (`transactions`, `accounts`, `csvParsers`,
`importRules`, `userSettings`) carries `updatedAt`, its version, and every change to the
document moves it:

- An update to the root row moves it through `$onUpdate` in the schema, with no route
  involved. That covers edits, soft deletes (tombstones), and upserts.
- A change to a transaction's postings alone doesn't touch its row. The ledger service
  moves the version itself (`touch`) in every function that changes postings. The gate
  above keeps posting writes inside the service.

`ledger/versions.test.ts` checks every writer.

## Rules written more than once

| Rule | Copies | Agree? |
|---|---|---|
| Postings balance per currency | `ledger/validate.ts` once in the backend (exact, in cents; `imbalance` is the rule on its own, which heal's pre-repair check uses too); `LedgerEditModal` and `AddTransactionModal` through `transactions/balance.ts`, which sums in cents with `frontend/src/lib/ledger-money.ts`, a byte-for-byte copy of `money.ts` that a frontend test keeps identical | Yes, since #450. The client still skips an amount it can't read yet, where the server answers `AMOUNT_INVALID` |
| An account belongs to the caller | `accountsOwnedBy` (`accounts/ownership-service.ts`: transactions, import commit, parser defaults, the per-account balance and action-required reads, coverage, rule targets and the settings defaults), and a hand-written `select` where the row itself is needed (`account-service` read, update, delete) or in Fish Pie | Same condition everywhere in the personal ledger |
| A date is `YYYY-MM-DD` | `calendar-date.ts` (`isCalendarDate`, also refusing days that don't exist) for transaction writes, the transaction routes and the balance-as-of date; hand-written regexes in the `GET /api/transactions` query, `reports.ts`, `fx-rates.ts`, and the Fish Pie expense and settlement routes | Same shape; only `calendar-date.ts` refuses `2026-02-30` |
| A currency is supported | `isValidCurrency` in `ledger/validate` (so every posting written, import and Fish Pie included), accounts, user-settings and fx-rates | Yes, for postings |
| A failure returned as a value | `Outcome<T>` in `errors.ts`, in every service and pure module; `parseBody` → `{ ok, response }` | One shape since #429, when `heal-service` and the rule target moved to it. `parseBody` stays, being route-level |
| Money arithmetic | `money.ts` in integer cents (the ledger check, both balance endpoints, reading CSV amounts, the import legs and the duplicate check, report totals, heal); `parseFloat` or `toFixed` still in Fish Pie, the import path's payer share included (#451). The converted spend total multiplies by a rate, so it stays a float product of cents, rounded once | No: Fish Pie is the last file |

## Pure modules

| Module | What | Called by |
|---|---|---|
| `errors.ts` | Every failure code with its status, the detail each carries, `errorBody` and `Outcome` | Every service and route; `respond.ts` sends one |
| `currencies.ts` | The supported currency set and `isValidCurrency` | Routes that accept a currency |
| `calendar-date.ts` | Calendar dates as `YYYY-MM-DD` text: check, read from a request or a CSV cell, add and count days, never through a time zone | Ledger writes, import, duplicate check, transaction and balance routes |
| `money.ts` | Amounts in integer cents: `parse`, `format`, `add`, `sub`, `neg`, `sum`, `splitByWeights` | `ledger/validate`, the balance endpoints |
| `import/csv-parser.ts` | Delimiter detection, CSV parsing, header fingerprint | Import preview |
| `import/dynamic-parser.ts` | Build a row parser from a saved column mapping; amounts read by `money.parse`, so a cell that is not a plain decimal is a row error | Import preview |
| `import/merchant.ts` | Merchant stem: strip terminal numbers, dates, references | Preview grouping, rule mining |
| `ledger/validate.ts` | Whether postings may be written as one transaction: count, currency, balance per currency | `ledger/write-service` |
| `import/postings.ts` | The legs for each import row kind, Fish Pie variants included. Derived legs are worked out in cents by `inCents`, which turns an unreadable amount into one the ledger check refuses | `import/commit-plan` |
| `import/commit-plan.ts` | Which accounts each row kind needs; the transaction and group expense each row becomes | `import/commit-service` |
| `import/preview.ts` | Which saved parser a file belongs to; the rule, merchant key and kind each row suggests | `import/preview-service` |
| `import/duplicates.ts` | Whether a row is probably a posting already in the ledger: same currency, a day either side, within a cent | `import/duplicates-service` |
| `import/fingerprint.ts` | Row keys, fingerprints and the ids they give imported transactions | Preview, commit and duplicate services |
| `postings/account-type.ts` | Resolve an account's type: override, then tagged ancestor, then path root | Accounts, roles, spend, coverage |
| `postings/roles.ts` | Classify each posting's role inside its transaction | Transactions list, rules, spend |
| `postings/heal.ts` | Detect, plan and preview the repair of malformed cross-currency spends. A phantom leg matches its bridge leg exactly, in cents | `heal-service` |
| `rules/target.ts` | Which target a rule's three id fields name, and the columns it's stored in | `rule-service` |
| `rules/mining.ts` | Which rules to suggest from the ledger: one expense leg, a merchant key, the account seen most, twice or more | `rule-service` |
| `reports/spending.ts` | Category totals and drill-down counts, month buckets, the rates a conversion needs, the converted total | `report-service` |
| `accounts/paths.ts` | What a valid path is, when two are the same (`pathKey`, `pathTakenBy`), the receivable namespace (`isClearingAccountPath`), and `planRename` | `account-service`, the accounts route's schema, classification, coverage |
| `accounts/balances.ts` | Which accounts a balances view shows (`readBalanceSelection`, `selects`) and per-currency sums in cents | `balance-service` |
| `coverage/intervals.ts`, `months.ts`, `catch-up.ts` | Merge coverage spans, classify months, assemble catch-up state | Coverage and catch-up services |
| `coverage/horizon.ts` | The horizon, cycle inference, merging the config, and reading and changing the pins (`overridesFrom`, `configChangeFrom`, `applyConfigChange`) | Coverage, config and load services |
| `coverage/reconcile.ts` | Where a reconcile's interval starts, and when it records nothing | `coverage-service` |
| `settings/preferences.ts` | Changes to the `preferences` blob: a shallow merge, and one account's catch-up override set or removed | `settings/settings-service` |
| `fish-pie/splits.ts` | Divide an expense by weight, remainder to the payer; which weights apply; the payer's share | `fish-pie-expense-service`, the expense routes |
| `fish-pie/legs.ts` | The legs of each member's expense, settlement and batch-settlement transactions | `fish-pie-expense-service`, the settlement routes |
| `fish-pie/balances.ts` | Net balances per currency and the minimal set of transfers | Balances, overview |
| `fish-pie/clearing.ts` | A group's clearing account path, from the group's name | `fish-pie-accounts-service`, the merge route |

The epic settles one convention: a `-service` file touches the database, and nothing else
does. Three files broke it and no longer do: `coverage/horizon.ts` lost its four loaders to
`coverage/config-service.ts` and `coverage/load.ts` became `coverage/load-service.ts` (#428),
the pure `fish-pie-balance-service.ts` became `fish-pie/balances.ts` (#430), and
`fish-pie-accounts.ts` became `fish-pie-accounts-service.ts`, its pure path rule going to
`fish-pie/clearing.ts` (#431). Since #431 the convention is a test, not a habit.

## How it got here, and what is left

The [domain-layer epic](../planning/epics/archive/domain-layer.md) (#423) did it in this
order:

1. This map (#424)
2. One write path for transactions (#425), then every posting writer through it (#426)
3. The P1 items that build on that path: #279, #281
4. Import planned in pure code (#427), then its fingerprint (#282)
5. Accounts and coverage (#428); rules, parsers, settings and reports (#429)
6. Fish Pie maths (#430)
7. A check that locks the layers in (#431)

What the layers still allow, each with its own issue:

- The eight `fish-pie-*` routes query and open transactions themselves until they leave
  for the Fish Pie service (#380).
- Fish Pie's maths is in floats rounded to the cent, where the ledger works in cents (#451).
