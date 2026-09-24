# Backend architecture

A map of `backend/src`, for someone who knows backends but not this one. It describes the
code as it is on `main` at `ba23404`, and the layering the [domain-layer
epic](../planning/epics/domain-layer.md) (#423) is moving it towards. Each story of that
epic updates this file in the same PR, so it should never describe code that no longer
exists.

## How a request flows

```
index.ts        Bun entry point: reads PORT and the static root, nothing else
  └ server.ts   one Hono server: the API first, then the built frontend, then the SPA fallback
      └ app.ts  the API: CORS → request logger → session guard → route
          └ routes/<resource>.ts   parse the body, check, query, write, answer
              ├ pure modules        import/, postings/, coverage/ … (no database)
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
| Route | Parse, read `userId`, call a service, shape the answer | Services, `validation`, `errors` | Most handlers also query, check and write directly |
| Service | Load, check, write inside one transaction | Domain, `db`, schema | A few exist: `heal-service`, `classify-service`, `spend-service`, `coverage/load`, `fish-pie-expense-service` |
| Domain | Pure rules | Nothing stateful | About 1,300 lines already: `import/*`, `postings/{account-type,roles,heal}`, `coverage/{intervals,months,catch-up}`, `currencies` |

`routes/catch-up.ts` (29 lines) and `routes/reports.ts` already look like the target:
the handler validates the query, calls a service, and answers. `routes/import.ts` (941
lines) is the furthest from it.

## Route map

Mount points are in `app.ts`. "Rules" is where the checks that make a write correct
actually live; "writes" lists the tables touched.

### Personal ledger

**`accounts.ts`** — `/api/accounts` (688 lines)

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `GET /` | Every active account, with its resolved type | `account-type` | — |
| `GET /balances` | Balance-bearing accounts with per-currency sums | Handler + `account-type-sql`; SQL `SUM` (#279) | — |
| `GET /posting-counts` | Entries and last activity per account | Handler (SQL) | — |
| `GET /:id/balance` | One account's balance as of a date | Handler; SQL `SUM` | — |
| `GET /action-required-summary` | Per account: uncategorized plus malformed-FX counts | Handler (raw SQL, #280) + `heal-service` | — |
| `GET /:id/action-required` | The same, for one account, with ids | Same | — |
| `GET /:id` | One account with resolved, inferred and inherited type | `account-type` | — |
| `POST /` | Create an account | Handler: path shape, not in the receivable namespace | `accounts` |
| `POST /rename` | Rewrite a path prefix across a subtree | Handler: collision and namespace checks | `accounts` |
| `PATCH /:id` | Name, currency, type override | Schema | `accounts` |
| `DELETE /:id` | Soft-delete one nothing depends on | Handler: no entries, not a default, not receivable | `accounts` |

**`transactions.ts`** — `/api/transactions` (609 lines)

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `GET /malformed-fx-spend` | Malformed cross-currency spends, before and after | `heal-service` | — |
| `GET /` | Transactions with postings and roles; filters by account, path, dates, spending | Handler + `roles`, `spend-service` | — |
| `POST /` | Create one transaction | Handler: posting count, currency, balance per currency | `transactions`, `postings` |
| `POST /bulk` | Create many, atomically | Handler: the same checks, a second copy | Same |
| `PATCH /:id` | Date and description | Schema | `transactions` |
| `POST /:id/postings` | Replace every posting, atomically | Handler: the same checks, a third copy | `postings` (hard delete + insert) |
| `POST /:id/heal-fx-spend` | Repair one malformed spend | `heal-service` → `heal` | `postings` |
| `DELETE /:id` | Soft-delete the transaction | Handler | `transactions`, `postings` (hard delete) |

**`postings.ts`** — `/api/postings` (163 lines). Single-posting edits, used by the raw
ledger editor. None of the three checks the transaction still balances (#432).

| Endpoint | Does | Writes |
|---|---|---|
| `PATCH /:id` | Change a posting's account, amount or currency | `postings` |
| `POST /` | Add one posting to a transaction | `postings` |
| `DELETE /:id` | Soft-delete a posting, keeping at least two | `postings` |

**`import.ts`** — `/api/import` (941 lines)

| Endpoint | Does | Rules | Writes |
|---|---|---|---|
| `POST /preview` | Match the CSV to a saved parser, parse it, suggest accounts from rules | `csv-parser`, `dynamic-parser`, `merchant`; rule matching and own-transfer detection in the handler | — |
| `POST /check-duplicates` | Possible duplicates per row, with Fish Pie context | Handler: ±1 day, same currency, amount within 0.01 | — |
| `POST /commit` | Write every row, and create Fish Pie expenses for split rows | Handler: per-row-kind checks, group and category checks; `import/postings` builds the legs | `transactions`, `postings`, Fish Pie tables |

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
| `parsers.ts` | `/api/parsers` | CRUD for saved CSV parsers: header fingerprint and column mapping |
| `user-settings.ts` | `/api/user-settings` | The settings row: default accounts, type roots, preferred currency, a free-form `preferences` merged in SQL (#278) |
| `reports.ts` | `/api/reports` | Spending summary, monthly spend, FX pairs, converted totals. All through `spend-service` |
| `fx-rates.ts` | `/api/fx-rates` | Rate for a date, or the latest within 7 days, cached in `fx_rates`. The backend's only outbound `fetch` |
| `coverage.ts` | `/api/coverage`, plus `/api/accounts/:id/coverage` | Coverage assertions, per-account config, reconcile, month view. Pure logic in `coverage/*` |
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

This is the table #425 and #426 exist to collapse into one row.

| Where | Inserts | Deletes postings by | Balance checked |
|---|---|---|---|
| `routes/transactions.ts` (create, bulk, replace) | Yes | Hard delete (replace, delete) | Yes, three copies |
| `routes/postings.ts` | One posting | Soft delete | **No** (#432) |
| `routes/import.ts` commit | Yes, by row kind | — | By construction (`import/postings`) |
| `postings/heal-service.ts` | Re-points existing legs | — | Amounts untouched, so it stays balanced |
| `fish-pie-expense-service.ts` | Member transactions | — | By construction |
| `routes/fish-pie-expenses.ts` | Rebuilds on edit | Soft delete | By construction |
| `routes/fish-pie-settlements.ts` | Payer and receiver transactions | Soft delete | By construction, two legs each |
| `routes/fish-pie-merge.ts` | — | Re-points postings between accounts | Amounts untouched |

"By construction" means the code that builds the legs makes them balance, and nothing
checks afterwards. It holds until an edit breaks it without any test failing.

**Deleting has two meanings.** A personal transaction's delete hard-deletes its postings.
A Fish Pie delete soft-deletes them. Postings are also hard-deleted and re-inserted with
new ids whenever a transaction's postings are replaced. `00-direction.md` (the correction
marked `F2`) explains why that makes the transaction, not the posting, the unit that syncs
(#281).

## Rules written more than once

| Rule | Copies | Agree? |
|---|---|---|
| Postings balance per currency | `transactions.ts` ×3 (`parseFloat`, tolerance 0.001); `LedgerEditModal` and `AddTransactionModal` in the frontend (tolerance 0.005) | No: two tolerances, and float arithmetic (#279) |
| An account belongs to the caller | More than 20 queries in three shapes: `accountsOwnedBy` (transactions), `ownsAccount` (coverage), and a hand-written `select` elsewhere | Same condition, but nothing shares it |
| A date is `YYYY-MM-DD` | The `isoDate` schema in `transactions.ts`, and hand-written regexes in the `GET /api/transactions` query, `reports.ts`, and the Fish Pie expense and settlement routes | Yes, but in separate places |
| A currency is supported | `isValidCurrency` in transactions, accounts, user-settings and fx-rates. Missing on import commit (#434) and the posting endpoints (#432) | Only where it's called |
| A failure returned as a value | `parseBody` → `{ ok, response }`; `heal-service` → `{ ok, failure }`; `rules.ts` → `{ columns } \| { failure }` | Three shapes of one idea. The epic picks one |
| The database transaction type | `Tx` in `fish-pie-accounts.ts`, `TxDb` in `fish-pie-expense-service.ts` | Two local aliases of one type |
| Money arithmetic | `parseFloat` or `toFixed` on over 90 lines (`import/postings`, the Fish Pie routes and services, `heal`, `transactions.ts`) | Floats. #279 replaces them with integer cents |

## Pure modules that already exist

| Module | What | Called by |
|---|---|---|
| `currencies.ts` | The supported currency set and `isValidCurrency` | Routes that accept a currency |
| `import/csv-parser.ts` | Delimiter detection, CSV parsing, header fingerprint | Import preview |
| `import/dynamic-parser.ts` | Build a row parser from a saved column mapping | Import preview |
| `import/merchant.ts` | Merchant stem: strip terminal numbers, dates, references | Preview grouping, rule mining |
| `import/postings.ts` | The legs for each import row kind, Fish Pie variants included | Import commit |
| `postings/account-type.ts` | Resolve an account's type: override, then tagged ancestor, then path root | Accounts, roles, spend, coverage |
| `postings/roles.ts` | Classify each posting's role inside its transaction | Transactions list, rules, spend |
| `postings/heal.ts` | Detect and plan the repair of malformed cross-currency spends | `heal-service` |
| `coverage/intervals.ts`, `months.ts`, `catch-up.ts` | Merge coverage spans, classify months, assemble catch-up state | Coverage and catch-up routes |
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
4. Import planned in pure code (#427), then its fingerprint (#282)
5. Accounts and coverage (#428); rules, parsers, settings and reports (#429)
6. Fish Pie maths (#430)
7. A check that locks the layers in (#431)
