# Backend architecture

A map of `backend/src`, for someone who knows backends but not this one. It describes the
code as it is on `main` (last updated by #450), and the layering the [domain-layer
epic](../planning/epics/domain-layer.md) (#423) is moving it towards. Each story of that
epic updates this file in the same PR, so it should never describe code that no longer
exists.

## How a request flows

```
index.ts        Bun entry point: reads PORT and the static root, nothing else
  └ server.ts   one Hono server: the API first, then the built frontend, then the SPA fallback
      └ app.ts  the API: CORS → request logger → session guard → route
          └ routes/<resource>.ts   parse the body, check, query, write, answer
              ├ services            *-service.ts: load, check, write (ledger/write-service, …)
              ├ pure modules        ledger/validate, import/, postings/, coverage/ … (no database)
              └ db/                 Drizzle client and schema (Postgres today, SQLite per D8)
```

- **The session guard** is in `app.ts`. Every `/api/*` path except `/api/auth/*` needs a
  Better Auth session, and the guard puts `userId` on the context. A route reads it with
  `c.get('userId')`, and every query it runs is expected to scope by it.
- **Request bodies** are parsed through a Zod schema declared beside the handler, via
  `parseBody(c, Schema)` in `validation.ts`. `bodies.test.ts` holds the rule. The eight
  `fish-pie-*` route files are exempt because they leave this repository under #380.
- **Failures** are a code plus the values that vary: `fail(c, 'ACCOUNT_NOT_FOUND')`. The
  codes and their HTTP status live in `errors.ts`, and the sentences live in the frontend's
  `copy/errors.ts`.
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

## Layers: today and target

| Layer | Target: does | Target: may import | Today |
|---|---|---|---|
| Route | Parse, read `userId`, call a service, shape the answer | Services, `validation`, `errors` | Most handlers also query, check and write directly. The transaction writes no longer do |
| Service | Load, check, write inside one transaction | Domain, `db`, schema | `ledger/write-service`, `import/{preview,duplicates,commit}-service`, `accounts/ownership-service`, `heal-service`, `classify-service`, `spend-service`, `coverage/load`, `settings/settings-service`, `fish-pie-expense-service` |
| Domain | Pure rules | Nothing stateful | About 1,300 lines already: `ledger/validate`, `import/*`, `postings/{account-type,roles,heal}`, `coverage/{intervals,months,catch-up}`, `currencies` |

`routes/catch-up.ts` (29 lines) and `routes/reports.ts` already look like the target:
the handler validates the query, calls a service, and answers. So does `routes/import.ts`
since #427, which was the furthest from it at 941 lines.

## Route map

Mount points are in `app.ts`. "Rules" is where the checks that make a write correct
actually live; "writes" lists the tables touched.

### Personal ledger

**`accounts.ts`** — `/api/accounts` (688 lines)

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `GET /` | Every active account, with its resolved type | `account-type` | — |
| `GET /balances` | Balance-bearing accounts with per-currency sums | Handler + `account-type-sql`; `money.sum` | — |
| `GET /posting-counts` | Entries and last activity per account | Handler (SQL) | — |
| `GET /:id/balance` | One account's balance as of a date | Handler; `money.sum` | — |
| `GET /action-required-summary` | Per account: uncategorized plus malformed-FX counts | Handler (raw SQL, #280) + `heal-service` | — |
| `GET /:id/action-required` | The same, for one account, with ids | Same | — |
| `GET /:id` | One account with resolved, inferred and inherited type | `account-type` | — |
| `POST /` | Create an account | Handler: path shape, not in the receivable namespace | `accounts` |
| `POST /rename` | Rewrite a path prefix across a subtree | Handler: collision and namespace checks | `accounts` |
| `PATCH /:id` | Name, currency, type override | Schema | `accounts` |
| `DELETE /:id` | Soft-delete one nothing depends on | Handler: no entries, not a default, not receivable | `accounts` |

**`transactions.ts`** — `/api/transactions` (437 lines). Every write goes through
`ledger/write-service`; the handlers parse and shape the answer.

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `GET /malformed-fx-spend` | Malformed cross-currency spends, before and after | `heal-service` | — |
| `GET /` | Transactions with postings and roles; filters by account, path, dates, spending | Handler + `roles`, `spend-service` | — |
| `POST /` | Create one transaction | `createTransaction`: `validatePostings`, then ownership | `transactions`, `postings` |
| `POST /bulk` | Create many, atomically | `createTransactions`: the same, with each entry's index | Same |
| `PATCH /:id` | Date and description | Schema | `transactions` |
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

**`rules.ts`** — `/api/rules` (413 lines). Import rules: a pattern that suggests an
account, or a Fish Pie group and category.

| Endpoint | Does | Rules |
|---|---|---|
| `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` | List, create, edit, soft-delete | `resolveTarget` in the handler file: exactly one target, owned or a member |
| `POST /mine` | Suggest rules from history: merchant stems with one consistent expense account, seen twice or more | Handler + `merchant`, `roles` |
| `POST /:id/approve`, `/deny`, `/revive` | Move a rule between suggested, active and denied | Handler |

**Smaller files**

| File | Mount | Does |
|---|---|---|
| `parsers.ts` | `/api/parsers` | CRUD for saved CSV parsers: header fingerprint, column mapping, default accounts (the caller's own) |
| `user-settings.ts` | `/api/user-settings` | The settings row: default accounts, type roots, preferred currency, a free-form `preferences` blob, shallow-merged. Writes through `settings/settings-service` |
| `reports.ts` | `/api/reports` | Spending summary, monthly spend, FX pairs, converted totals. All through `spend-service` |
| `fx-rates.ts` | `/api/fx-rates` | Rate for a date, or the latest within 7 days, cached in `fx_rates`. The backend's only outbound `fetch`, so nothing but a `YYYY-MM-DD` date reaches its URL |
| `coverage.ts` | `/api/coverage`, plus `/api/accounts/:id/coverage` | Coverage assertions, per-account config (stored in `preferences.catchUp`, through `settings/settings-service`), reconcile, month view. Pure logic in `coverage/*` |
| `catch-up.ts` | `/api/catch-up` | The catch-up coach's summary. `coverage/load` + `coverage/catch-up` |

### Fish Pie

Eight files, about 2,100 lines, mounted under `/api/fish-pie`. They leave this repository
for the Fish Pie service under #380. The split and settlement maths they use stays here,
because the client runs it (#430).

| File | Does |
|---|---|
| `fish-pie-groups.ts` | Create, list, rename and delete groups; member settings (share weight, default accounts) |
| `fish-pie-invites.ts` | Invite by email, list, cancel, accept, decline |
| `fish-pie-categories.ts` | Categories per group: each member's private account mapping and the shared weight vector |
| `fish-pie-expenses.ts` | Create, list, edit and delete shared expenses. Every member's ledger transaction is rebuilt on edit. The edit handler alone is about 290 lines |
| `fish-pie-settlements.ts` | Settle up: one payment, or a batch across currencies. The receiver confirms. Two-sided ledger writes |
| `fish-pie-balances.ts`, `fish-pie-overview.ts` | Who owes whom, computed by `fish-pie-balance-service` |
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
decimal type; SQLite has none. `splitByWeights` is the one split rule: each share is
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
own JSON operators; the row lock (`FOR UPDATE`) is now the only Postgres-only step, and
SQLite, which admits one writer at a time, needs nothing in its place.

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
| An account belongs to the caller | More than 20 queries in three shapes: `accountsOwnedBy` (`accounts/ownership-service.ts`, used by transactions, import commit and parser defaults), `ownsAccount` (coverage), and a hand-written `select` elsewhere | Same condition, but nothing shares it |
| A date is `YYYY-MM-DD` | `calendar-date.ts` (`isCalendarDate`, also refusing days that don't exist) for transaction writes, the transaction routes and the balance-as-of date; hand-written regexes in the `GET /api/transactions` query, `reports.ts`, `fx-rates.ts`, and the Fish Pie expense and settlement routes | Same shape; only `calendar-date.ts` refuses `2026-02-30` |
| A currency is supported | `isValidCurrency` in `ledger/validate` (so every posting written, import and Fish Pie included), accounts, user-settings and fx-rates | Yes, for postings |
| A failure returned as a value | `Outcome<T>` in `errors.ts` (`ledger/`); `parseBody` → `{ ok, response }`; `heal-service` → `{ ok, failure }`; `rules.ts` → `{ columns } \| { failure }` | `Outcome` is the one the epic chose. `heal-service` and `rules.ts` move to it when their stories touch them; `parseBody` stays, being route-level |
| Money arithmetic | `money.ts` in integer cents (the ledger check, both balance endpoints, reading CSV amounts, the import legs and the duplicate check, report totals, heal); `parseFloat` or `toFixed` still in Fish Pie, the import path's payer share included (#451). The converted spend total multiplies by a rate, so it stays a float product of cents, rounded once | No: Fish Pie is the last file |

## Pure modules that already exist

| Module | What | Called by |
|---|---|---|
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
| `postings/heal.ts` | Detect and plan the repair of malformed cross-currency spends. A phantom leg matches its bridge leg exactly, in cents | `heal-service` |
| `coverage/intervals.ts`, `months.ts`, `catch-up.ts` | Merge coverage spans, classify months, assemble catch-up state | Coverage and catch-up routes |
| `settings/preferences.ts` | Changes to the `preferences` blob: a shallow merge, and one account's catch-up override set or removed | `settings/settings-service` |
| `fish-pie-balance-service.ts` | Net balances per currency and the minimal set of transfers | Balances, overview |

Two names mislead:

- **`fish-pie-balance-service.ts` is pure**, despite the `-service` suffix.
- **`coverage/horizon.ts` is pure except its last four functions**, which read settings and
  intervals from the database.

The epic settles one convention: a `-service` file touches the database, and nothing else
does.

## Where this is going

The target and the order are in [`planning/epics/domain-layer.md`](../planning/epics/domain-layer.md):

1. This map (#424)
2. One write path for transactions (#425), then every posting writer through it (#426)
3. The P1 items that build on that path: #279, #281
4. Import planned in pure code (#427), then its fingerprint (#282, done)
5. Accounts and coverage (#428); rules, parsers, settings and reports (#429)
6. Fish Pie maths (#430)
7. A check that locks the layers in (#431)
