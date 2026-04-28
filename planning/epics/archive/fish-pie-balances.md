# Epic: Fish Pie — Balances & Settlement

**Goal:** Show each group member a clear picture of who owes whom, and let members record settlements to reset the balance.

---

## Background

A balance is derived — not stored. It is computed from the full expense + split history:

For each member, sum the amounts they paid (from `groupExpenses`) and subtract the amounts they owe (from `groupExpenseSplits`). The result is their net position in the group.

From net positions, compute the minimal set of transfers that clears all debts (the "simplify debts" algorithm). This is what gets shown to users: "Alice owes Bob $40".

**Multi-currency:** balances are per-currency. If a group has expenses in both CAD and USD, the balance summary has two rows. No cross-currency conversion at this layer.

A settlement is a recorded payment between two members that offsets the balance. It is stored as a special expense-like record (not a split expense — just a direct transfer between two members).

---

## Stories

### 1. Balance computation (backend)

- Add a `GET /api/fish-pie/groups/:id/balances` route.
- Response: per-currency net position for each member, plus a simplified list of "who pays whom" transfers that clears the board.
- Algorithm: for each currency, compute net per member → run greedy creditor/debtor matching to get minimal transfer set.
- No new DB tables — computed from existing data.
- Test: a group with 3 members and 3 expenses produces the correct net positions and minimal transfer list.

### 2. Settlements schema + API (backend)

**`groupSettlements`**
- `id` uuid pk
- `groupId` uuid → expenseGroups.id
- `fromUserId` uuid → users.id (the payer)
- `toUserId` uuid → users.id (the recipient)
- `amount` numeric(12,2) not null
- `currency` text not null
- `date` text not null (YYYY-MM-DD)
- `note` text
- `createdAt` timestamp
- `deletedAt` timestamp (soft delete)

Settlements feed into balance computation: a settlement from A to B reduces A's debt to B by the settlement amount.

Routes under `/api/fish-pie/groups/:id/settlements`:
- `POST /` — record a settlement. Body: `{ fromUserId, toUserId, amount, currency, date, note? }`. Both users must be members.
- `GET /` — list settlements for the group.
- `DELETE /:settlementId` — soft-delete. Either party or group creator.

Generate and apply migrations (dev + test). One smoke test.

### 3. Balances panel (frontend)

On the group detail page, a "Balances" section:

- Per-currency breakdown: for each currency, show the simplified transfer list ("Alice → Bob: CAD 40.00").
- If all balances are zero (or no expenses), show "All settled up".
- "Settle up" button next to each suggested transfer — pre-fills the settlement form.

### 4. Settlement form + history (frontend)

On the group detail page:

- "Record settlement" form: from (selector), to (selector), amount, currency, date, optional note.
- Settlement history list below balances: date, from → to, amount. Soft-delete button.
- Balances panel re-computes after any settlement is added or removed.
