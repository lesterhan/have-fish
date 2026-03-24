# Epic: Starting Balances

Goal: Let users record an opening balance for any asset account, and add a guided flow for creating a new asset account that begins with a balance.

## Background

A starting balance is just a regular transaction with two postings:

| Account           | Amount    | Currency |
|-------------------|-----------|----------|
| assets:rbc:chq    | +5000.00  | CAD      |
| equity:start      | −5000.00  | CAD      |

The offset account (`equity:start`) is configurable via a new user setting.
No schema changes needed — this is pure workflow and UI.

---

## Stories

### 1. User settings — add `defaultEquityStartPath`

Backend / DB.

- Add `defaultEquityStartPath text` to `userSettings` schema, default `'equity:start'`
- Generate and apply migration
- Expose in `GET /api/user-settings` response
- Add "Opening balances account" field to the settings page UI

### 2. Backend — earliest transaction date for an account

Backend / accounts route.

- Add `GET /api/accounts/:id/earliest-transaction`
- Returns `{ date: string | null }` — the ISO date of the earliest transaction
  that has a posting for this account (`MIN(transactions.date)` joined through postings)
- Used by the frontend to default the opening balance date

### 3. User flow — set starting balance on an existing account

Frontend / Assets page.

- Each account row on the Assets page gets a "Set opening balance" action
- Opens a small inline form or modal: amount, currency, date
- Date field: fetches `GET /api/accounts/:id/earliest-transaction` on open;
  if a date is returned, default to one day before it; otherwise default to today
- On confirm: POST to `/api/transactions` with the two-posting pattern above
- Pre-fills the equity offset account from `userSettings.defaultEquityStartPath`
  (creates it if it doesn't exist yet)

### 4. User flow — create new asset account with starting balance

Frontend / Assets page.

- "Add asset account" button on the Assets page
- Form: account path (AccountPathInput, pre-filled with the assets root as a hint),
  opening balance amount, currency, date
- On confirm: create the account, then create the opening balance transaction
- If opening balance is zero or blank, skip the transaction step
