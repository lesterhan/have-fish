# Epic: Fish Pie — Ledger Signs

**Goal:** Fix the inverted postings on non-payer member transactions (BUG-005), which
(a) make shared expenses *subtract* from the non-payer's spending reports and
(b) are the root cause of the deferred BUG-004a (payer's `group:` balance never
clears after settlement). One sign flip plus a data migration resolves both.

**Status:** In Progress (approved 2026-06-11) — see
`planning/exploration/fish-pie-experience.md` (finding F13).

**Scope note:** the flip applies to **non-payer** member transactions only. The same
2-posting code branch also serves "payer without source account" (legacy fallback,
still reachable — see BUG-006); that path keeps its current signs and is resolved
separately.

---

## Background

Every path that records an expense share posts it **positive** to the expense
account — except one:

| Path | Expense posting | Clearing (`group:`) posting |
|------|-----------------|------------------------------|
| CSV import offset (`buildRegularPostings`) | `+amount` | — |
| Import-linked fish-pie (`buildFishPiePostings`) | `+payer_share` | `+others_share` |
| Manual payer 3-posting (`createMemberTransactionsInTx`) | `+payer_share` | `+others_share` |
| **Non-payer member 2-posting** | **`−share`** ✗ | **`+share`** ✗ |

Verified consequences (test-reproduced 2026-06-11, see BUGS.md BUG-005):

1. **Spending reports wrong for the non-payer.** `reports.ts` sums raw posting
   amounts under the `expenses:` root. The non-payer's share of every shared expense
   enters negative and cancels their imported spending.
2. **BUG-004a.** The debtor's `group:` balance accumulates `+share` per expense, and
   the settlement payer leg adds another `+amount` — it can never clear. With the
   debtor balance correctly recorded as `−share`, the *existing* settlement code
   clears it to zero. The receiver/creditor side is already correct.

Correct double-entry for the non-payer, in this codebase's sign convention
(positive = money entering the account):

```
expenses:food        +50.00   ← my share of the spending
group:household      −50.00   ← I owe this; clears to 0 when I settle
```

---

## Stories

### 1. Flip the non-payer posting signs

`backend/src/fish-pie-expense-service.ts`, `createMemberTransactionsInTx`, the
2-posting (non-payer) branch: expense posting becomes `+share`, shared posting
becomes `−share`.

Single choke point — POST create, PATCH rebuild, and the future proposals confirm
endpoint all route through this function. No settlement code changes.

**Tests:**
- Non-payer member tx: expense posting `+share`, group posting `−share`, sums to 0.
- Non-payer's `/api/reports/spending-summary` includes `+share` (regression for the
  verified bug — reuse the scenario from BUGS.md BUG-005).
- Full settlement round-trip: expense → debtor's `group:` balance is `−share` →
  settlement initiated by debtor + confirmed by creditor → **both** parties'
  `group:` account balances are 0 (this is the BUG-004a regression test).
- Payer 3-posting path unchanged (existing tests keep passing).

### 2. Data migration for historical member transactions

One-off migration (SQL migration via drizzle, or a guarded script) that flips the
sign of every posting belonging to a **non-payer member transaction**:

```sql
-- postings of transactions where
--   transactions.group_expense_id IS NOT NULL
--   AND transactions.user_id != group_expenses.paid_by_user_id
UPDATE postings SET amount = -amount WHERE ...
```

Why this discriminator is safe:
- Payer member txs (2- or 3-posting): `userId = paidByUserId` → untouched.
- Import transactions: linked via `groupExpenses.transactionId` (opposite
  direction), no `groupExpenseId` → untouched.
- Settlement transactions: no `groupExpenseId` → untouched.
- **Active transactions only** (`transactions.deleted_at IS NULL`). Soft-deleted
  member txs are excluded on purpose: when an expense's payer is edited, the old
  payer's tx is soft-deleted but `paidByUserId` now points at the new payer, so a
  soft-deleted *payer* tx can satisfy `userId != paidByUserId` and would be wrongly
  flipped. Nothing reads soft-deleted postings, so leaving them is harmless.

**Tests:** seed one of each transaction generation (debtor member tx, payer
3-posting, legacy payer 2-posting, import-linked, settlement pair), run migration,
assert only the debtor tx flipped.

### ~~3. Rename `group:<slug>` → `assets:receivable:<slug>`~~ → moved to the Categories epic

**Decided 2026-06-11:** rename approved, bundled into the categories merge migration
(`fish-pie-categories.md` story 3) so account paths churn only once.

---

## Out of scope

- **BUG-006** — web edits omit `paymentAccountId`, degrading the payer tx to the
  legacy 2-posting form. Separate fix (PATCH fallback to `defaultPaymentAccountId`);
  fully reworked by the proposals epic.

- Legacy payer 2-posting transactions (pre-expense-management era) also under-record
  the payer's own spending. Different pattern, payer-owned, not covered by the
  discriminator above. Revisit only if historical reports matter.
- `uncategorized` account living outside the `expenses:` root (invisible to spending
  reports) — addressed by the categories epic.
