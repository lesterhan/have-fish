# Epic: Fish Pie — Account Integration

**Goal:** Make Fish Pie expenses real transactions that post to personal ledger accounts, closing the gap between shared-expense tracking and the main finance ledger.

---

## Background

Currently Fish Pie group expenses live in their own tables (`groupExpenses`, `groupExpenseSplits`) and are completely isolated from the main transaction/posting system. A $100 grocery bill split with a partner never appears in `expenses:groceries`. This epic bridges that gap.

**The model:** every group expense auto-posts each member's share to their configured default expense account for the group. The balancing credit leg goes to a per-group `shared:<group-slug>` account (auto-created at group join), which tracks the net balance owed within that group — consistent with the original `shared:groupname` concept from the expenses epic background.

Example — partner pays $100 food, split 50/50:
- Auto-posted for you: `expenses:food` −$50 (debit) / `shared:food-group` +$50 (credit — you owe)
- Auto-posted for partner: `expenses:food` −$50 / `shared:food-group` +$50

Example — you pay $100 food, split 50/50:
- Auto-posted for you: `expenses:food` −$50 / `shared:food-group` +$50 (partner owes you, so shared is a receivable here)
- Auto-posted for partner: `expenses:food` −$50 / `shared:food-group` +$50

Settlement transactions (Epic 2) clear the `shared:<group>` account by moving money to/from an asset account, completing the ledger picture.

**Who-paid does not create a separate source-account posting.** The payer's credit card or cash transaction is tracked separately (via CSV import or manual entry). Fish Pie only auto-posts the *share allocation* — not the funding source. This avoids double-counting.

**Untagging a split:** if a user added an expense by mistake or wants to remove the group association, the edit transaction modal gets a "remove from group" action. This soft-deletes the group expense and reverses (soft-deletes) the auto-created postings.

---

## Schema changes

### `expenseGroupMembers` — add default expense account

```
defaultExpenseAccountId  uuid  nullable → accounts.id
```

Each member independently configures which account receives their share of group expenses. If null, shares post to their `uncategorized` account (see migration story).

### `groupExpenses` — link to transaction

```
transactionId  uuid  nullable → transactions.id
```

When an expense is auto-posted, the resulting transaction is linked here. Existing rows have `null` (migrated in Story 4).

---

## Stories

### 1. Per-member default expense account (backend + frontend)

**Backend:**
- Migration: add `defaultExpenseAccountId` to `expenseGroupMembers`.
- `PATCH /api/fish-pie/groups/:id/members/me` — update `defaultExpenseAccountId`. Validates account belongs to calling user.
- Include `defaultExpenseAccountId` in group member response.

**Frontend:**
- On the group detail page, each member row shows their configured expense account (visible to all members for transparency).
- "My settings" section: account picker to set your own default expense account for this group. Displays a hint: "expenses here will post to this account as your share."
- Use the existing account selector component.

Tests: update returns 200; non-member cannot update; account must belong to user.

### 2. `shared:<group>` account auto-creation

- When a user joins or creates a group, auto-create (if not exists) an account with path `shared:<group-name-slugified>` scoped to that user.
- Slug: lowercase, spaces → hyphens, strip non-alphanumeric except hyphens.
- Store the resulting `accountId` — used as the balancing leg for all auto-postings in this group.
- Expose a helper `ensureSharedAccount(userId, group)` in the backend for reuse.

No frontend changes needed — this is internal plumbing.

### 3. Auto-posting on expense add (backend)

Update the `POST /api/fish-pie/groups/:id/expenses` handler:

After writing the expense + splits, for each member with a non-null `defaultExpenseAccountId`:
- Create one transaction: `{ date, description: expense.description, userId: member.userId }`.
- Write two postings:
  - `expenses:food` account: `−split.amount` (debit — money leaving the expense account)
  - `shared:<group>` account: `+split.amount` (credit — balance owed/receivable)
- Store the transaction id on the `groupExpenses` row.

If a member has no `defaultExpenseAccountId`, post to their `uncategorized` account instead (created in Story 5 / migration).

Wrap expense insert + split insert + transaction + postings in a single DB transaction.

Tests:
- Expense with two members, both have default account → two transactions created, postings correct.
- Member with no default account → posts to uncategorized.
- DB failure mid-way → entire insert rolled back.

### 4. Edit transaction modal — untag group split

The existing edit transaction modal (`TransactionEditModal`) gains a "Remove from group" section, visible only when `transaction.groupExpenseId` is set.

**Behaviour:**
- Show: "This transaction is linked to [group name] as a shared expense."
- Button: "Remove from group" (destructive, confirmation required).
- On confirm:
  - `DELETE /api/fish-pie/groups/:groupId/expenses/:expenseId` (soft-delete the group expense).
  - Also soft-delete the auto-created transaction + postings for *all* members (not just the current user — the expense is removed for everyone).
  - The original transaction (the one open in the modal) is not deleted — only the group linkage + auto-postings are removed.

**Backend:**
- `DELETE /api/fish-pie/groups/:groupId/expenses/:expenseId` already exists; extend it to also soft-delete the linked `transactionId` and its postings.
- Only the payer or group creator may do this (existing rule, keep it).

**Frontend:**
- Add the "Remove from group" block to the modal.
- After removal, refetch the transaction (group badge disappears) and the group expense list.

Tests: untag removes group expense + linked transaction + postings; original transaction untouched.

### 5. Migration — existing group expenses (backend)

A one-time migration script (not a Drizzle migration — a standalone `bun run migrate:fish-pie` script):

**Pre-requisites created by the migration:**
- For each user that has any group expense splits: ensure an `uncategorized` account exists (`path: 'uncategorized'`). Reuse existing if found.
- For each group: ensure a `shared:<slug>` account exists for each member.

**For each existing `groupExpenses` row:**
- For each split: create a transaction + two postings (debit `uncategorized`, credit `shared:<group>`) for the split's user.
- Link `groupExpenses.transactionId` to the created transaction.

**Safety:**
- Run in a single DB transaction — all or nothing.
- Log each migrated expense id + user.
- Idempotent: skip rows where `transactionId` is already set.

Add `bun run migrate:fish-pie` to `package.json` scripts.

Note: Lester has few prod Fish Pie transactions so migration impact is low.

### 6. `uncategorized` account (backend)

- Add a helper `ensureUncategorizedAccount(userId)` that finds or creates an account with `path: 'uncategorized'` for the given user.
- Used by the migration script and by the auto-posting logic (Story 3) when `defaultExpenseAccountId` is null.
- The `uncategorized` account does not need to be auto-created at user signup — it is created lazily on first need.
