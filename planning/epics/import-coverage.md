# Epic: Import Coverage — the catch-up board

**Goal:** Answer "which accounts am I behind on, and for what dates?" After weeks of
travel without importing, show a grid of accounts × months where each cell is
*covered*, *partial* or *outstanding*, and make the outstanding cells actionable.

## The core problem: absence is ambiguous

"No transactions on `assets:rbc:chq` in July" means either *I spent nothing* or
*I never imported July*. Nothing in the current data model can tell those apart —
transactions record what happened, never what was **looked at**.

So coverage must be **asserted**, not derived. The system records intervals of
"this account is known-complete for these dates", written automatically when a CSV
is imported and manually for accounts that have no CSV (cash, manual entry).

Nothing today records this: there is no import-batch table, and reconciliation
(`planning/epics/archive/reconciliation.md`) stores only an adjustment posting and a
settings path — no per-account coverage record.

## Design decisions (locked)

- **Intervals, not a watermark.** `[startDate, endDate]` rows per account. A single
  `importedThroughDate` column can't represent a hole in the middle (imported Jan and
  Mar, missed Feb) — and worse, importing March would silently claim February.
- **Intervals are normalized on write.** Overlapping or adjacent intervals
  (`endDate + 1 day == next startDate`) merge into one row per account. Reads stay
  trivial and the grid renders from a short list.
- **Coverage attaches to the statement account only.** The `sourceAccountId` (or the
  request-level `accountId`), never the offset/target/fee account. Importing an RBC
  chequing statement that contains a credit-card payment must **not** claim coverage
  on the credit card — that account has its own statement.
- **Coverage comes from the file, not from the committed rows.** A file whose rows
  were all skipped as duplicates still proves those dates were looked at. Commit only
  receives kept rows, so the import UI sends an explicit `coverage` array computed
  from the whole parsed file. The backend falls back to min/max of the committed rows
  when it's absent (older clients, API callers).
- **The span is editable at commit time.** A bank export labelled "Jan 1 – Jun 30"
  whose first row is Jan 9 covers Jan 1 onward. The commit UI prefills min/max row
  dates and lets the user widen them.
- **Tracking is opt-in per account via one nullable column.** `accounts.coverageFrom`
  — null means untracked (`equity:*`, `expenses:*`, `assets:receivable:*` are noise on
  this board); a date means "track from here". Doubles as the opt-in flag and the
  left edge of the grid.
- **The current month is never "behind".** A statement for the month in progress
  can't exist yet. The current month renders as *in progress* and is excluded from
  the days-behind count.
- **Dates are `text` `YYYY-MM-DD`,** matching `groupExpenses.date` /
  `groupSettlements.date`. "Today" is the server's UTC date; there is no per-user
  timezone in the schema and a one-day edge on a catch-up board is harmless.

## Schema delta

```ts
export const accountCoverage = pgTable('account_coverage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  startDate: text('start_date').notNull(),   // YYYY-MM-DD, inclusive
  endDate: text('end_date').notNull(),       // YYYY-MM-DD, inclusive
  source: text('source').notNull(),          // 'import' | 'manual'
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (t) => [index('account_coverage_account_id_idx').on(t.accountId)])

// accounts gains:
coverageFrom: text('coverage_from'),  // YYYY-MM-DD; null = not tracked
```

`source` is kept after merging (an interval that mixes both becomes `'import'`, the
stronger claim) purely for display — "auto-recorded" vs "you marked this".

## Cell states

| State | Meaning | Colour |
|---|---|---|
| `covered` | every day of the month within `[coverageFrom, today]` is covered | green |
| `partial` | some days covered | amber |
| `outstanding` | no days covered | red |
| `in-progress` | the month containing today, whatever its coverage | neutral |
| `untracked` | before `coverageFrom`, or the account is untracked | empty |

`daysBehind` = days from the last covered day (before the current month) to the start
of the current month. That is the number worth putting on a badge.

---

## Stories

### 1. Backend — schema + migrations

`account_coverage` table, `accounts.coverageFrom`. `db:generate`, then both
`db:migrate` and `db:migrate:test`.

### 2. Backend — coverage CRUD + interval normalization

New `backend/src/routes/coverage.ts`.

- `POST /api/coverage` — `{ accountId, startDate, endDate, source?, note? }`,
  defaults `source: 'manual'`. Inserts and **normalizes** the account's intervals in
  one transaction. Returns the account's resulting interval list.
- `DELETE /api/coverage/:id` — soft delete, then re-normalize.
- `PATCH /api/accounts/:id` (existing route, `accounts.ts:392`) accepts
  `coverageFrom` — validated `YYYY-MM-DD` or null.

The normalizer is a pure exported function (`mergeIntervals`) so it can be tested
without the DB: sorts by `startDate`, merges overlapping **and** adjacent intervals,
never crosses account boundaries.

Validation: account must belong to the caller and be non-deleted (404 otherwise —
never leak another user's account ids); `endDate >= startDate`; `endDate` not in the
future.

Tests: adjacent merge (`Jan 1–31` + `Feb 1–28` → `Jan 1–Feb 28`), overlapping merge,
disjoint stays two rows, containment is a no-op, other user's account → 404, future
`endDate` → 400, delete re-splits correctly.

### 3. Backend — derived grid + summary

Cell derivation lives in the backend so web and mobile share one answer.

- `GET /api/coverage?months=12` → per tracked account:
  `{ accountId, path, name, coverageFrom, intervals[], months: [{ month: 'YYYY-MM', state }], lastCoveredThrough, daysBehind }`.
- `GET /api/coverage/summary` → `{ accountId, daysBehind, outstandingMonths }[]`,
  only accounts that are behind. Same shape and lazy-load role as
  `/api/accounts/action-required-summary` (`accounts.ts:223`), so the frontend store
  pattern carries over.

Tests: full-month coverage → `covered`; one-day gap → `partial`; nothing →
`outstanding`; the current month → `in-progress` even with zero coverage and never
counted in `daysBehind`; months before `coverageFrom` → `untracked`; untracked
accounts omitted; soft-deleted accounts omitted.

### 4. Backend — import commit records coverage

`POST /api/import/commit` (`import.ts:283`) accepts an optional
`coverage: { accountId, startDate, endDate }[]`.

- Each entry's account must belong to the caller (400 otherwise) — validated up front
  with the existing fail-fast block, before any writes.
- Written inside the same transaction as the postings: an import that rolls back must
  not leave a coverage claim behind.
- Fallback when absent: group the committed rows by their resolved source account and
  record min/max date per account. Offset, target and fee accounts are never included.
- Multi-currency parsers (Wise) derive a child account per row — the per-row source
  account is the one that gets coverage, which the explicit array expresses naturally.

Tests: explicit array recorded verbatim; fallback derives per source account; offset
account gets **no** coverage; multi-account file yields one interval per account;
a failing commit leaves no coverage row; foreign account id → 400.

### 5. Frontend — the catch-up board

New route `frontend/src/routes/(authed)/catch-up/+page.svelte`.

- `Card` + `.section-header`, rows = tracked accounts, columns = last 12 months.
  Wide grid scrolls inside its own `overflow-x: auto` container.
- Sticky first column (account path), legend below the grid.
- Cell click → popover: **Import CSV** (deep-links to `/import` with the account
  preselected), **Mark covered** (that month), **Mark covered through today**.
- Empty state when no account is tracked yet, linking to the enable flow in story 7.
- All colours from tokens (`--color-amount-positive` / `--color-amount-negative` and
  the accent ramp); no hard-coded hex.

### 6. Frontend — import page sends the span

The import preview panel gains a "This file covers …" line with two editable dates,
prefilled from min/max of **all** parsed rows (including ones unchecked as
duplicates). Multi-account files show one line per account. The values ride along in
the commit body from story 4.

### 7. Frontend — enable tracking + behind badge

- Account page and/or the accounts list: a "Track import coverage" toggle that sets
  `coverageFrom` (defaults to the account's earliest transaction date, editable).
- `coverageStore` mirroring `actionRequiredStore`: loaded once in the layout, feeds a
  sidebar indicator on behind accounts and a dashboard tile ("3 accounts behind,
  oldest 98 days").

### 8. Mobile — read-only catch-up list (optional)

A settings-screen list of behind accounts with their days-behind. Read-only; importing
stays a desktop workflow.

---

## Open questions

- **Auto-suggest tracking.** Any account that is a `csvParsers.defaultAccountId` is by
  definition a CSV account — offer tracking for those on first visit rather than
  making the user hunt for the toggle.
- **Grace period.** Statements lag a few days. The current-month rule covers most of
  it; a per-account `graceDays` is the escape hatch if it isn't enough. Not in scope.
- **Expected cadence.** A per-account statement cadence ("monthly on the 5th") would
  turn the board into a due-list. Deliberately deferred — more per-account config than
  the problem currently justifies.
- **Does reconciliation imply coverage?** A completed reconciliation to a statement
  balance is a strong claim that the period is complete. Tempting to auto-write
  coverage from it, but reconciliation records no period today. Revisit if
  reconciliation grows a statement period.
