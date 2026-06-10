# Epic: Fish Pie — Expense Management

**Goal:** Replace the blunt delete button on logged expenses with a proper edit/delete panel, enforce double-entry accounting on manual expenses by requiring a payment source account, and surface clear confirmation dialogs so the user understands exactly which accounts are affected before destructive actions.

---

## Background

After a fish pie expense is logged it appears in the right-side panel (`GroupRightPanel.svelte`) with a single delete button. Three problems:

1. **No edit path.** Mistakes in split ratio, payer, or description require a full delete and re-entry.
2. **Delete is silent.** No confirmation; no indication of which transactions and accounts disappear.
3. **Manual expenses are under-recorded.** The manual expense form never asks which account the payer paid from. The payer's member transaction only captures their personal share (`expenses:food -60, shared +60`) — the $100 they fronted from their Visa is never recorded. Import-linked expenses don't have this problem because the source account is always known.

### Posting structure recap

**Import-linked payer transaction (3 postings, balanced):**
```
liabilities:visa        -100.00   ← source account
group:slug              +40.00    ← others' share (clearing)
expenses:food           -60.00    ← payer's own share
                        ───────
                          0.00 ✓
```

**Manual payer transaction today (2 postings — legacy after this epic):**
```
expenses:food           -60.00    ← payer's share only; $100 outflow unrecorded
expenses:shared:food    +60.00    ← clearing
                        ───────
                          0.00 ✓ (balances, but source account missing)
```

After this epic, all new manual expenses follow the 3-posting pattern. Existing 2-posting transactions remain valid legacy data — they still balance internally and require no migration.

---

## Stories

### 1. Edit expense panel

Replace the delete button in `GroupRightPanel.svelte` with an **Edit** button. Clicking opens an edit form pre-filled with the current expense values.

**Editable fields:**
- Description
- Amount
- Date
- Payer (dropdown of group members)
- Share weights per member (same UI as the create form)

**Backend — `PATCH /api/fish-pie/groups/:groupId/expenses/:expenseId`:**

In a single DB transaction:
1. Soft-delete all existing member transactions and their postings (same logic as current delete, minus the import transaction — the import transaction is *not* touched on edit, only on delete).
2. Re-run `createGroupExpenseInTx` with updated values, reusing the same `groupExpenses` row (update it in place: description, amount, currency, date, `paidByUserId`). Keep `transactionId` unchanged.
3. If the expense is import-linked (has `transactionId`): also update the import transaction's postings to reflect the new split ratio — delete old postings, rebuild with `buildFishPiePostings` (or the appropriate variant) using the new `payerShareRatio`.
4. Replace `groupExpenseSplits` rows: delete existing, insert recomputed splits.

Authorization: payer or group creator only (same as delete).

**Frontend:**
- Edit form reuses the same component as the create form where possible.
- On success: reload the expense in the right panel, show a brief "Saved" confirmation.
- Cancel returns to the read view without changes.

**Tests:**
- Edit description/amount → correct values in DB, postings recomputed.
- Edit payer → old payer's member tx deleted, new payer's tx created (or skipped if import-linked).
- Edit split ratio → postings recomputed for all members.
- Edit import-linked expense → import tx postings updated, import tx itself not deleted.
- Non-payer/non-creator → 403.

---

### 2. Delete with confirmation dialog

Delete remains available but moves to a secondary destructive action (e.g., a "Delete expense" link at the bottom of the edit panel).

**Confirmation dialog content** (computed server-side or client-side from the expense data):

For a **manual expense:**
```
Delete "[description]"?

This will remove:
• [N] member transactions
• Accounts affected: [list of expense accounts and shared accounts]

This cannot be undone.
          [Cancel]  [Delete]
```

For an **import-linked expense:**
```
Delete "[description]"?

This will remove the group split AND the original import transaction.

Accounts affected:
• [source account] (the original payment will be erased)
• [group:slug] (clearing entries removed)
• [expense accounts for each member]

If you only want to remove the split, use "Remove from group" instead.
          [Cancel]  [Remove from group]  [Delete]
```

The dialog must name the actual account paths (not just "member transactions"), because the user needs to understand ledger impact. Fetch the account names from the expense detail endpoint — they're already available in the postings.

**Backend:** No change to the existing delete endpoint. The dialog logic is frontend-only.

**Tests:**
- Confirmation dialog renders with correct account names for manual expense.
- Confirmation dialog renders with correct account names for import-linked expense.
- "Remove from group" option only visible for import-linked expenses (placeholder — wired up in a future story if scoped in).
- Delete still calls the existing endpoint and produces the same soft-delete result.

---

### 3. Required "Paid from account" on manual expenses

Manual expense creation must require a source account. This account is remembered per user per group so the user doesn't re-enter it every time.

**Schema change — `expenseGroupMembers`:**

Add column: `defaultPaymentAccountId uuid REFERENCES accounts(id)`. Nullable in DB (for existing rows and non-payer members) but the UI enforces it before submission when the current user is the payer.

**Backend:**

- `GET /api/fish-pie/groups/:groupId` (or the members endpoint): include `defaultPaymentAccountId` in the member payload so the frontend can pre-fill.
- `PATCH /api/fish-pie/groups/:groupId/members/:userId` (new or extend existing): accept `defaultPaymentAccountId` to update the stored account. Called automatically on expense submission if the selected account differs from the stored one — so the field self-updates without a separate settings step.
- `POST /api/fish-pie/groups/:groupId/expenses`: require `paymentAccountId` in the body. Use it to build the payer's transaction as a **3-posting transaction** (same as import path):
  - Drop `skipPayerMemberTx` for the payer in `createGroupExpenseInTx`.
  - Instead, create a dedicated payer transaction with `buildFishPiePostings`-equivalent logic: `source: -full_amount`, `group:slug: +others_share`, `expenses:food: -payer_share`.
  - Non-payer members continue to use the 2-posting member transaction pattern (unchanged).
- Remove the old 2-posting payer path from `createGroupExpenseInTx`. The `skipPayerMemberTx` flag remains (still needed for the import path where the import tx is the payer transaction) but the fallback of creating a 2-posting payer member tx is gone.

**Frontend:**

- Add an account path text input at the top of the expense creation form, above description. Label: "Paid from account". Pre-filled from `member.defaultPaymentAccountId` if set.
- Block form submission if field is empty (show inline validation).
- On successful submission, fire the `PATCH` to update `defaultPaymentAccountId` if it changed.
- UX is intentionally minimal now (plain text input for account path) — a proper account picker is a future improvement.

**Tests:**
- Create expense with `paymentAccountId` → payer tx has 3 postings: source `-100`, group `+others`, expense `-payer_share`.
- Create expense without `paymentAccountId` → 400.
- `defaultPaymentAccountId` stored on member after first use, pre-filled on next call.
- Non-payer members still get 2-posting member transactions.
- Import-linked expense creation unchanged (still uses `skipPayerMemberTx=true` + import tx postings).
