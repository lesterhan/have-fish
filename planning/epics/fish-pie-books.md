# Epic: Fish Pie — Books (trips & one-off pots)

**Goal:** Let one group hold more than one *stream* of shared spending — everyday
(coffee, groceries, rent) and one-off pots (a Europe trip, a shared purchase) —
without the one-off spending polluting the everyday expense list or its reporting.
Balances and settlement stay **group-wide and unchanged**: one settle-up wipes
everything, so money never bounces back and forth between two half-settled ledgers.

A **book** is a named, optionally date-bounded, optionally closable bucket of
expenses inside a group. Every expense belongs to exactly one book. Every group has
a seeded *Everyday* book and a reassignable `defaultBookId`.

## Why a book and not a second group

The Categories epic (merged 2026-06-11) deliberately collapsed *category-as-group*
into **one group per household + a category per expense**, because separate groups
force separate settlements that net to zero on paper but still move real money.
`fish-pie-merge.ts` exists to fold legacy groups into categories.

Adding a second group for travel would reintroduce exactly that problem, and
cross-group settlement is expensive: `computeCurrencyBalances`
(`backend/src/fish-pie-balance-service.ts:57`) nets one group, `groupSettlements`
has a `groupId` FK, the clearing account is per group (`assets:receivable:<slug>`),
and batch confirm/delete (`backend/src/routes/fish-pie-settlements.ts:154`) all
assume one group.

A book is a second axis *inside* the group. Netting, clearing accounts, settlement
batches, confirm and delete are untouched — the entire feature is a filter plus a
weight override.

**Deferred, not rejected:** if a book ever needs a member the group doesn't have
(a friend joins the Europe trip), that's a separate *settlement circle* epic.
Books cannot express it — every book shares the group's member set. Per-expense
splits already let a member take a 0 share, which covers "one of us sat this out".

## Books vs categories — orthogonal axes

| | Categories | Books |
|---|---|---|
| Question | *what kind* of spending | *which pot* it belongs to |
| Example | Food, Housing, Transport | Everyday, Europe 2026 |
| Lifecycle | long-lived, archivable | often closed when the trip ends |
| Weights | Housing 60/40 | Europe 50/50 |

A Europe hotel is `category = Housing`, `book = Europe 2026`. It must **not** pick
up the everyday Housing 60/40 weight — hence book weights outrank category weights.

## Design decisions (locked)

- **Everyday is a real book row, not `null`.** `groupExpenses.bookId` is `NOT NULL`.
  A nullable "everyday means null" bucket would be cheaper (no migration, no seed)
  but permanently costly: a `bookId ?? 'everyday'` branch at every aggregation and
  UI site including mobile, `string | null` leaking through the API types, and — the
  real blocker — the everyday stream could never own a weight vector, a default
  currency, or a rename, because those all key on a book id. One backfill migration
  buys a model with no privileged value. Hand-written data migrations are already
  routine here (`drizzle/0029_flip_nonpayer_member_tx_postings.sql`,
  `drizzle/0036_backfill_import_tx_group_expense_id.sql`).
- **`expenseGroups.defaultBookId` decides where new expenses land** when a client
  doesn't name a book (import, mobile quick-add). It is **reassignable** — point it
  at "Europe 2026" while travelling and everything auto-files there, point it back
  after. This is the one privileged book, and it's a user setting rather than a
  hardcoded value.
- **Books never touch the ledger or settlement.** No book column on
  `groupSettlements`, no book-scoped clearing account. A settlement clears a *net*
  debt; attributing that net to one book would be arbitrary and would let the two
  books disagree about what's settled.
- **Consequence — the per-book breakdown is gross, not net.** Per book we show
  paid − owed *before* settlements, then settlements as one line, then the
  group-wide net. `Σ books − settlements = group net` is the identity the balance
  panel must display, or the numbers look wrong.
- **Weight resolution order becomes:** explicit per-expense splits → **book
  weights** (only when every current member has one) → category weights (same
  condition) → stored group member weights. Extends the ladder documented at
  `backend/src/routes/fish-pie-expenses.ts:296`.
- **Closing a book is `closedAt`, mirroring `groupCategories.archivedAt`.** Closed
  books drop out of create flows but stay resolvable for existing expenses, and
  still contribute to balances — a closed trip you haven't settled is precisely
  the thing you must not hide. The default book cannot be closed or deleted;
  reassign `defaultBookId` first.
- **A book may carry a `defaultCurrency`.** Europe 2026 defaults new expenses to
  EUR; Everyday leaves it null and falls back to the group default. Pure form
  prefill, no math.

## Schema delta

```ts
export const expenseBooks = pgTable('expense_books', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => expenseGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  defaultCurrency: text('default_currency'),      // prefill only; null = group default
  startDate: text('start_date'),                  // YYYY-MM-DD, optional
  endDate: text('end_date'),                      // YYYY-MM-DD, optional
  sortOrder: integer('sort_order').notNull().default(0),
  closedAt: timestamp('closed_at'),               // hidden from create flows, still in balances
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('expense_books_group_id_idx').on(t.groupId)])

// The group's agreed split weight for a member within a book. Shared, not private —
// same trust model as groupCategoryWeights.
export const expenseBookWeights = pgTable('expense_book_weights', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull().references(() => expenseBooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  weight: integer('weight').notNull(),
}, (t) => [unique().on(t.bookId, t.userId)])

// groupExpenses gains:
bookId: uuid('book_id').notNull().references(() => expenseBooks.id),

// expenseGroups gains:
defaultBookId: uuid('default_book_id').references(() => expenseBooks.id),
```

Two FK notes, both deliberate:

- **`groupExpenses.bookId` has no `onDelete`** (NO ACTION, not `restrict`). Deleting a
  group cascades to `expense_books` *and* `group_expenses` in the same statement;
  NO ACTION is checked at end of statement so both cascades resolve, whereas
  `restrict` fires immediately and would block the group delete. Book deletion is
  guarded at the app layer instead (409 when the book has expenses).
- **`expenseGroups.defaultBookId` stays nullable in the DB** — the group row must
  exist before its first book can reference it. The app guarantees it is set inside
  the same transaction as group creation; readers fall back to the lowest-`sortOrder`
  book if it is ever null.

### Migration (two files)

1. **Generated** — create `expense_books` + `expense_book_weights`, add
   `group_expenses.book_id` **nullable**, add `expense_groups.default_book_id`.
2. **Hand-written backfill** — for **every** group including soft-deleted ones
   (a soft-deleted group still owns expense rows, and the `NOT NULL` applies to
   them): insert one book `('Everyday', sortOrder 0)`, set the group's
   `default_book_id` to it, `UPDATE group_expenses SET book_id = <its group's book>`,
   then `ALTER TABLE group_expenses ALTER COLUMN book_id SET NOT NULL`.

Run `db:generate`, then both `db:migrate` and `db:migrate:test`.

---

## Stories

### 1. Backend — schema, migration, books CRUD

Model `backend/src/routes/fish-pie-books.ts` on `fish-pie-categories.ts` (same
`requireMembership` helper shape, same `fetchBooksForGroups(groupIds)` export so the
overview can embed them).

- `GET /api/fish-pie/groups/:groupId/books` — all books, open first, then
  `sortOrder`, `name`. Each carries `expenseCount`, its weight vector, and
  `isDefault`.
- `POST /api/fish-pie/groups/:groupId/books` — `{ name, defaultCurrency?, startDate?, endDate?, sortOrder? }`.
- `PATCH /api/fish-pie/groups/:groupId/books/:bookId` — rename, dates, currency,
  `closedAt` (close/reopen via `{ closed: true|false }`).
- `DELETE /api/fish-pie/groups/:groupId/books/:bookId` — 409 if it has expenses
  (close it instead; the error names the count), 409 if it is the default.
- `PUT /api/fish-pie/groups/:groupId/books/:bookId/weights` — full vector, mirroring
  the category weights endpoint.
- `PATCH /api/fish-pie/groups/:id` (existing, `fish-pie-groups.ts:98`) accepts
  `defaultBookId` — must be an open book of that group.

**Seed the Everyday book at both group-creation sites**, inside their existing
transactions: `fish-pie-groups.ts:35` and `fish-pie-merge.ts:75`. Merge also
re-points the source groups' expenses onto the merged group's default book.

Validation: name required and unique per group (case-insensitive); `endDate >=
startDate`; dates `YYYY-MM-DD`; non-members get 404, never 403.

Tests: CRUD happy paths; a new group comes back with exactly one book and a matching
`defaultBookId`; non-member 404; duplicate name 409; delete-with-expenses 409;
delete-the-default 409; close-the-default 409; close/reopen round trip; weights
replace-not-merge; `defaultBookId` reassignment rejects a closed or foreign book;
merge lands every source expense on the merged default book.

### 2. Backend — `bookId` on expenses + weight resolution

- Create accepts `bookId`; **omitted → the group's `defaultBookId`**. Never null.
- Edit accepts `bookId`; omitted → keep; explicit `null` → 400 (an expense always has
  a book). Contrast with `categoryId`, where explicit null legitimately clears.
- Reject a `bookId` from another group (400); reject a **closed** book on create,
  tolerate it on edit — identical to the archived-category rule.
- `applyBookWeights` runs before `applyCategoryWeights`; a book vector applies only
  when every *current* member has an entry.
- `GET .../expenses?bookId=<id|all>` filter.

Tests: create without `bookId` lands on the default; book weights beat category
weights; incomplete book vector falls through to category then member weights;
explicit per-expense splits still win; cross-group `bookId` rejected; closed book
rejected on create, accepted on edit; explicit null on edit → 400; filter returns
the right partition.

### 3. Backend — overview payload + per-book breakdown

Extend `GET /api/fish-pie/groups/:id/overview` (`fish-pie-overview.ts:20`):

- `group.books` — from `fetchBooksForGroups`; `group.defaultBookId` already rides
  along on the group row.
- `bookBreakdown` — `{ bookId, currency, netPositions[] }[]`, computed by a new
  `computeBookBreakdown` next to `computeCurrencyBalances` in
  `fish-pie-balance-service.ts`, from the **same** already-fetched expense array (no
  extra queries). `bookId` is a plain `string` — no null bucket.
- Top-level `balances` is unchanged — group-wide, settlement-aware.

The breakdown deliberately excludes settlements; the service exports the identity
`Σ bookBreakdown − settlements = balances` and a test asserts it holds.

Tests: breakdown sums back to the pre-settlement net per currency; closed books still
appear; a group whose expenses all sit in one book yields one bucket; empty group
returns `[]`.

### 4. Frontend — book switcher + expense form

- Group page: a segmented switcher above the expense list — `Everyday | Europe 2026 | All`.
  Hidden entirely when the group has one book, so nothing changes for single-book
  users. Selection persists per group in `localStorage`, defaulting to the group's
  default book.
- `GroupExpenseForm.svelte`: book picker defaulting to the switcher's current book;
  picking a book with a `defaultCurrency` sets the currency field (only while the
  user hasn't touched it).
- The expense list shows a book chip on rows only in `All` view.

### 5. Frontend — balance panel breakdown

`GroupBalancePanel.svelte`: per-book rows, a settled line, then the net and the
existing **Settle up** button (unchanged — still group-wide, still opens
`GroupSettleBatchModal`).

```
Europe 2026      you are owed   420.00 EUR
Everyday         you owe        180.00 CAD
Settled                       −  50.00 CAD
────────────────────────────────────────
Net to settle    you are owed  ~380.00 CAD
[ Settle up ]
```

Collapses to today's layout when the group has one book. Copy must make clear the
button settles *everything*.

### 6. Frontend — book manager

`BookManager.svelte` alongside `CategoryManager.svelte` in `GroupRightPanel`:
create, rename, set dates/currency, close/reopen, delete-when-empty, **set as
default**, and edit the book weight vector (same control as category weights, with an
explicit "falls back to category/member weights" empty state). The default book is
badged, and its close/delete actions are disabled with a reason.

### 7. Import — book on Fish Pie split rows

`FishPiePills.svelte` / `GroupSelect.svelte` gain a book choice next to the category
choice; `POST /api/import/commit` `groupSplits` entries accept `bookId` and validate
it like `categoryId` (`import.ts:283`). Omitted → the group's default book, so
existing import behaviour is unchanged.

### 8. Mobile — book picker + breakdown

- Add screen (`mobile/app/(app)/index.tsx`): book picker prefilled with the group's
  default book, shown only when the group has more than one open book.
- Balances screen (`balances.tsx`): the same per-book breakdown rows above the
  existing net. Settlement flow untouched.

### 9. (Optional) Per-book expense account mapping

`expense_book_member_accounts (bookId, userId, accountId)` — private per member, same
shape as `groupCategoryMemberAccounts`. Resolution: book mapping → category mapping →
member default → uncategorized. Lets the whole Europe trip land in
`expenses:travel:europe-2026` regardless of category. Cut this story if it isn't
pulling its weight; nothing else depends on it.

---

## Open questions

- **Naming.** "Book" is the code name. UI could say *Trip*, *Pot*, or *Tab*.
  Renaming later is a UI-string change only.
- **Should a closed book with a non-zero position nag?** Natural fit for the
  deferred Fish Pie attention/notifications work rather than this epic.
- **Auto-switch the default book by date?** A book with `startDate`/`endDate`
  spanning today is a decent guess at "where new expenses go" while travelling.
  Tempting, but silent auto-filing is hard to notice when wrong — keep
  `defaultBookId` explicit, and consider a "you're in Europe 2026 — make it the
  default?" prompt instead.
