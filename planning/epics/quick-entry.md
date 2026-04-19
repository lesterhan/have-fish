# Epic: Quick Entry

Goal: Let users rapidly enter a batch of credit card transactions from an account view, without the friction of the full transaction modal. Designed for a weekly sit-down where you transcribe charges from online banking.

## Background

CSV import works well for catching up historically but requires a monthly statement. The manual transaction modal is too slow for batch entry — it opens, closes, and resets for every transaction. Quick Entry solves this by providing a persistent row-based entry table scoped to a single account, where you can type down a week's worth of charges and submit them all at once.

The flow:
- Open the account view for a credit card
- Click "Quick Entry" to open a right-side panel (same two-column layout used in spending and settings pages)
- The panel header shows the account name + a currency selector (panel-level, not per-row)
- The panel shows a row table: Date | Description | Amount | Offset Account
- The "from" account is fixed (the current account)
- Currency applies to all rows and defaults to the account's `defaultCurrency`
- Offset account defaults to the user's `defaultOffsetAccountId` setting, overridable per row
- Submit creates all rows as individual transactions in a single atomic call

When the monthly statement arrives later, CSV import with duplicate detection will skip rows that already exist, filling in any gaps from missed weeks.

---

## Stories

### 1. Backend — account default currency

Accounts need a `defaultCurrency` field so quick entry knows which currency to pre-select.

- Add `defaultCurrency text` column to the `accounts` table in `schema.ts` (nullable)
- Generate and apply migration (`db:generate` + `db:migrate` + `db:migrate:test`)
- Expose `defaultCurrency` on the `GET /api/accounts` and `GET /api/accounts/:id` responses
- Add `PATCH /api/accounts/:id` endpoint (or extend existing if it exists) to update `defaultCurrency`

Write a minimal smoke test: PATCH an account's `defaultCurrency`, confirm it's returned on GET.

### 2. Backend — bulk transaction endpoint

`POST /api/transactions/bulk`

- Accepts an array of transaction payloads (same shape as `POST /api/transactions`)
- Wraps all inserts in a single DB transaction — all or nothing
- Returns the array of created transactions
- Reuse existing validation logic (balance check, at least 2 postings)

Write a minimal smoke test: one valid batch of 2 transactions creates both; one invalid row (imbalanced) rolls back the whole batch.

### 3. Frontend — Quick Entry side panel

On the account view (`/account/[id]`):

- Add a "Quick Entry" button to the account toolbar
- Clicking it opens a right-side panel, making the layout two-column (same pattern as spending and settings pages)
- Panel header:
  - "Adding to: [account name]"
  - Currency selector (e.g. a small dropdown or inline `<select>`) pre-populated from account's `defaultCurrency`, falling back to user's `preferredCurrency`
  - Changing the currency selector PATCHes the account's `defaultCurrency` immediately (so it sticks next time)
- Row table with columns: Date | Description | Amount | Offset Account | ×
  - Date: defaults to today; when adding a new row, carry forward the date from the previous row
  - Description: optional free text
  - Amount: number with sign — negative = charge (debit from this account), positive = refund. Show a small label "− charge / + refund" near the field
  - Offset Account: `AccountPathInput` dropdown, defaults to `defaultOffsetAccountId` from user settings
  - ×: remove this row
- "Add row" button below the table; also triggered by pressing Enter or Tab past the last field on the last row
- Keyboard flow: Tab moves through fields left-to-right; Tab past the last field on a row moves to the first field of the next row (adding one if needed)
- Submit button: "Save [n] transactions" — disabled if no rows or any row has an invalid amount
- On submit: POST to `/api/transactions/bulk` — each row becomes a 2-posting transaction using the panel-level currency for both postings (this account + offset account, balanced to zero)
- On success: close the panel, refresh the transaction list
- On error: show inline error, keep panel open
