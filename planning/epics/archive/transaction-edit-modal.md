# Epic: Transaction Edit Modal

Full editing of a transaction via a modal dialog, closer to the hledger journal format.

## Stories

### Story 1 — Backend: schema + new posting endpoints

**Schema change:** Add `createdAt` timestamp to the `postings` table. Postings have no ordering column today — without this, the modal can't display them in a stable insertion order. Generate and apply migrations to both dev and test databases.

**New endpoints:**

- `POST /api/postings` — creates a new posting on an existing transaction. Body: `{ transactionId, accountId, amount, currency }`. Verify the transaction belongs to the authenticated user.
- `DELETE /api/postings/:id` — soft-deletes a posting (set `deletedAt`). Must verify posting belongs to the authenticated user's transaction. Reject if it would leave fewer than 2 active postings on the transaction.

**Extended endpoint:**

- `PATCH /api/postings/:id` — currently only accepts `accountId`. Extend to also accept `amount` and `currency` so the modal can edit the full posting.

Tests co-located in `postings.test.ts`.

---

### Story 2 — TransactionEditModal: view

A modal (using the existing `Modal` component) that displays a transaction in hledger-style read-only layout. No editing yet — just get the structure and presentation right.

**Layout:**

```
┌─ Edit Transaction ────────────────────────────────────┐
│                                                        │
│  Click any field to edit                               │
│                                                        │
│  2026-03-29    Lunch at the diner                      │
│                                                        │
│  assets:checking          -10.00 CAD                   │
│  expenses:food             10.00 CAD                   │
│                                                        │
│  ────────────────────────────────────────────          │
│  Balance: 0.00 ✓                                       │
│                                                        │
│  [ Cancel ]                            [ Save ]        │
└────────────────────────────────────────────────────────┘
```

- Postings ordered by `createdAt` ascending (insertion order)
- Balance row shows sum per currency; green checkmark if all currencies balance to zero
- Save is disabled (greyed out) — editing comes next story
- Wire up the Edit button in `TransactionRow` to open this modal

---

### Story 3 — TransactionEditModal: inline editing

Layer in all editable fields and interactions.

**Editable fields:**
- **Date** — plain `<input type="date">`, same commit-on-blur / Escape-to-cancel pattern
- **Description** — auto-sizing input (same grid sizer trick as TransactionRow)
- **Posting account** — `AccountPathInput` (search + create), same focusout cancel pattern
- **Posting amount** — inline number input; revert to last valid value on blur if non-numeric or empty
- **Posting currency** — small text input; revert on blur if not a known currency code

**Balance validation:**
- Computed per-currency: each currency's postings must independently sum to zero
- If any currency is out of balance: show the imbalance amount in `--color-danger` with tooltip "Balance must be zero"
- Save button remains disabled until all currencies balance

**Adding a posting:**
- "+ Add posting" button below the postings list
- Appends a new row pre-filled with `defaultOffsetAccountId` and amount `0.00` in the transaction's primary currency
- New row is immediately editable

**Removing a posting:**
- Small × button on each posting row; disabled when only 2 active postings remain
- Clicking × does not immediately delete — marks the posting for deletion in local state
- The row renders with a strikethrough and is no longer editable; the × becomes an undo button
- Deletion is only committed (soft-delete via `DELETE /api/postings/:id`) when the user confirms Save

**Unsaved changes warning:**
- Clicking Cancel or the modal backdrop while there are unsaved changes shows a confirmation: "Discard changes?"
- Pressing Escape also triggers this check
- "Discard" closes the modal and reverts all local state; "Keep editing" returns to the modal

---

### Story 4 — Save and sync

- On Save: fire all necessary API calls in order — PATCH transaction (date, description), PATCH postings (account, amount, currency), POST new postings, DELETE removed postings
- On success: close the modal and update `localPostings` and `localDescription` in the parent `TransactionRow` so the row reflects the saved state without a page reload
- On any API error: show an inline error message, keep the modal open so the user doesn't lose their work
