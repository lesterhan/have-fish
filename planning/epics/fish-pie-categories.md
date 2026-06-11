# Epic: Fish Pie — Categories (single-group restructure)

**Goal:** Replace category-as-group modeling (one group per spending category) with
**one group per household + a category on each expense**. Cross-category netting then
falls out of the existing balance computation, settlement happens once per month per
currency, and the import flow picks a category instead of a group.

**Status:** Draft — designed together 2026-06-11, see
`planning/exploration/fish-pie-experience.md` (findings F1, F14; Flow A approved).

---

## Background

Today each category (Food, Housing, Shows, Gifts…) is its own group, because the
expense account is fixed per member per group (`expenseGroupMembers.defaultExpenseAccountId`).
Consequences:

- Balances are scoped per group, so "she owes $100 in Housing, I owe $100 in Food"
  requires two settlements even though they net to zero. Within a single group the
  balances endpoint already nets across all expenses — merging groups makes
  cross-category netting automatic, with no balance-logic changes.
- N groups × N members `group:<slug>` clearing accounts clutter the ledger.
- In the import flow, picking a group conflates "share this" with "categorize this".

Constraint (Lester): the quick-entry experience must not get heavier. Design answer:
**category chips with a sticky last-used default** — zero extra taps when logging a
run of same-category expenses, one tap to switch.

Important migration fact: current groups have **different split weights**
(Housing 60/40, Food 70/30). Categories must therefore carry per-category default
weights, otherwise the merge loses information.

---

## Data model

```
groupCategories
  id          uuid pk
  groupId     uuid fk → expenseGroups (cascade)
  name        text          -- "Food", "Housing" — shared vocabulary for the group
  sortOrder   integer
  archivedAt  timestamp     -- soft archive; expenses keep pointing at archived rows

groupCategoryMemberAccounts
  id          uuid pk
  categoryId  uuid fk → groupCategories (cascade)
  userId      text fk → user
  accountId   uuid fk → accounts        -- this member's expense account for the category
  shareWeight integer                    -- nullable; per-category default split
  unique(categoryId, userId)

groupExpenses
  + categoryId uuid fk → groupCategories, nullable (null = uncategorized/legacy)
```

Resolution order for a member's expense account:
`groupCategoryMemberAccounts.accountId` → `expenseGroupMembers.defaultExpenseAccountId`
→ `ensureUncategorizedAccount`.

Resolution order for split weights: per-expense override (PATCH `splits`) →
category weights (if every member has one) → group member weights.

Each member maps a category to *their own* account tree (my `expenses:food` vs her
`expenses:groceries`) — preserves the principle that fish pie posts into each user's
real accounts on their own terms.

---

## Stories

### 1. Backend — categories CRUD

- `GET/POST /api/fish-pie/groups/:groupId/categories`
- `PATCH /api/fish-pie/groups/:groupId/categories/:id` (rename, sortOrder, archive)
- `PUT /api/fish-pie/groups/:groupId/categories/:id/my-mapping`
  `{ accountId, shareWeight? }` — each member manages only their own mapping.
- Group GET includes categories + the current user's mappings.
- Auto-suggest mapping on first use: if the member has an account whose leaf name
  matches the category name (case-insensitive), pre-fill it in the UI (frontend
  concern, but the GET payload should include enough to do it).

Tests: CRUD, member-scoped mapping auth, archived categories excluded from create
flows but still resolvable for existing expenses.

### 2. Backend — categoryId on expenses

- `POST`/`PATCH /expenses` accept optional `categoryId` (validated against the
  group; archived → 400 on create, allowed to persist on edit).
- `createMemberTransactionsInTx` resolves each member's expense account via the
  category (resolution order above).
- Per-category weights feed `computeSplits` when no explicit splits are given.
- Expense responses include `categoryId` + category name.
- Import commit: `groupSplits` entries gain optional `categoryId`; the payer's
  expense-account leg of the import tx resolves through the category as well.

Tests: account resolution order, weight resolution order, import with category,
import without category (falls back to member default), PATCH recategorization
rebuilds member txs against the new accounts.

### 3. Backend — merge migration ("convert groups to categories")

`POST /api/fish-pie/groups/merge` `{ groupIds: string[], name: string }`

Validations: ≥2 groups, identical member sets, caller is a member of all.

In one DB transaction:
1. Create the target group (name from body) with the union member set; member
   `shareWeight` from the first group (it becomes the *fallback* only).
2. For each source group, create a category named after it; copy each member's
   `defaultExpenseAccountId` → category mapping `accountId`, and the member's
   source-group `shareWeight` → mapping `shareWeight` (preserves Housing 60/40 vs
   Food 70/30).
3. Re-point `groupExpenses` (set new `groupId` + `categoryId`) and
   `groupSettlements` (`groupId`).
4. Soft-delete source groups.

Ledger accounts — **decided 2026-06-11: clean variant + rename.** The merged group's
clearing account is created as `assets:receivable:<slug>` (positive = owed to me,
negative = I owe; single net account per group). Old `group:<slug>` clearing-account
postings are re-pointed to the new account and the old accounts soft-deleted, so
account paths churn exactly once. `ensureSharedAccount` switches to the new path
scheme (`fish-pie-accounts.ts`), and any UI string matching on the `group:` prefix
(e.g. the import-tx posting lookup in `fish-pie-expenses.ts` PATCH) must follow.

Tests: weights preserved per category, expenses/settlements re-pointed, balances of
the merged group equal the sum of the source groups' balances per currency,
non-identical member sets → 400.

### 4. Frontend — category management (group settings page)

Section on `fish-pie/[id]/settings`: list/add/rename/archive categories, my account
mapping per category (AccountPathInput, with the name-match auto-suggestion), my
per-category split display. Members see which categories lack a mapping for them
(badge — these fall back to defaults/uncategorized).

### 5. Frontend — category chips in add/edit expense

- `GroupExpenseForm`: horizontal chip row (same visual language as payer chips),
  preselected to the user's last-used category in this group (persist in settings
  preferences, like `recentGroups`). Selecting a category with per-category weights
  updates the slider display to that default.
- Edit form in `GroupRightPanel`: same chips; recategorizing calls PATCH.
- Expense list rows + detail view show a category pill.

### 6. Frontend — import flow category pick

- `GroupSelect` popover: when the user has exactly one group (the expected state
  post-merge), the popover lists **categories** directly — same tap count as today.
  With multiple groups: group list first, then categories inline.
- Pill becomes `🥧 <group> · <category>`; share-hint pill uses category weights.
- `RowState.groupId` → `{ groupId, categoryId }`; commit payload updated.

### 7. Frontend — merge flow

Guided modal from the fish-pie index page ("Combine groups…"): pick groups, name the
merged group, preview the resulting categories + weights, confirm. Calls story 3's
endpoint. Shown only when ≥2 groups share an identical member set.

### 8. (Stretch) Per-category balance breakdown

"Tally up" view for month-end: per-category totals + each member's share within the
period, alongside the existing net positions. Read-only aggregation over
`groupExpenses` × `categoryId`; no new tables.

---

## Sequencing notes

- **After** the ledger-signs epic (BUG-005) — its migration discriminator relies on
  current posting shapes; don't interleave two posting migrations.
- **Before** the expense-proposals epic — proposals' confirm flow should be built
  against the category-aware creation path so it isn't reworked twice.
- Mobile stays as-is until this lands (already broken; accepted).

## Out of scope

- Rule-driven auto-categorization on import (needs the import-rules epic first).
- Notifications/attention badges (separate epic).
- Multi-currency settle consolidation (separate epic).
