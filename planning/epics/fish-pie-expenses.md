# Epic: Fish Pie — Group Expenses

**Goal:** Let group members log expenses within a group. Each expense is automatically split among members according to their share weights. Members can see the full expense list.

---

## Background

An expense in Fish Pie is distinct from a transaction in the main ledger. It lives in its own table and represents money one member spent on behalf of the group. The split tells each member how much of that expense they "owe" toward the payer.

Split amounts are computed from each member's `shareWeight` relative to the sum of all weights in the group at the time the expense is added. Results are rounded to 2 decimal places; any rounding remainder is added to the payer's own share.

Expenses can be in any currency. All members in the group see the original currency — no conversion at this layer.

**Ledger integration:** when a user logs an expense they paid, it should also create a transaction in their personal ledger — debiting the account they paid from (e.g. `assets:cash` or `liabilities:visa`) and crediting a shared account named after the group (e.g. `shared:groupname`). The `shared:groupname` account acts as a receivable — it represents money the group owes back to this user. This keeps the user's own balance sheet accurate: the cash left their account, and the shared account tracks what's owed collectively. Members who did not pay do not get a ledger transaction — their obligation is tracked only in Fish Pie.

The `shared:groupname` account should be auto-created (as a regular account in the existing account tree) the first time a user joins or creates a group. Account path convention: `shared:<group-name-slugified>`.

Expenses are soft-deleted.

---

## Stories

### 1. Expenses schema + migration (backend)

**`groupExpenses`**
- `id` uuid pk
- `groupId` uuid → expenseGroups.id
- `paidByUserId` uuid → users.id
- `description` text not null
- `amount` numeric(12,2) not null (always positive)
- `currency` text not null
- `date` text not null (YYYY-MM-DD)
- `createdAt` timestamp
- `deletedAt` timestamp

**`groupExpenseSplits`**
- `id` uuid pk
- `expenseId` uuid → groupExpenses.id
- `userId` uuid → users.id
- `amount` numeric(12,2) not null — this member's share of the expense
- Unique constraint on `(expenseId, userId)`

Splits are computed and written at insert time, not on the fly. This means historical splits are preserved even if share weights change later.

Generate and apply migrations (dev + test).

### 2. Expenses API (backend)

Routes under `/api/fish-pie/groups/:id/expenses`:

- `POST /` — add expense. Body: `{ description, amount, currency, date, paidByUserId? }` (defaults to current user). Compute splits from current member weights; write expense + splits atomically. Returns expense with splits.
- `GET /` — list expenses for the group, newest first. Include splits and payer info. Members only.
- `DELETE /:expenseId` — soft-delete. Payer or group creator only.

One smoke test per route. Test that split amounts sum to the expense amount.

### 3. Add expense form (frontend)

On the group detail page (`/fish-pie/[id]`):

- "Add expense" form: description, amount, currency (text input, uppercased), date (defaults to today), "Paid by" selector (defaults to self, lists all group members).
- On submit, expense appears at the top of the list.

### 4. Expense list (frontend)

On the group detail page, below the add form:

- List of expenses: date, description, payer name, amount + currency.
- Expand/collapse each expense to show the split breakdown per member.
- "Delete" button on expenses you paid or if you are the creator.
- Empty state message.
