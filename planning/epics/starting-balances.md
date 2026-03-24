# Epic: Starting Balances

Goal: Let users record an opening balance for any asset account via an account settings modal on the Assets page.

## Background

A starting balance is just a regular transaction with two postings:

| Account           | Amount    | Currency |
|-------------------|-----------|----------|
| assets:rbc:chq    | +5000.00  | CAD      |
| equity:start      | −5000.00  | CAD      |

The offset account (`equity:start`) is configurable via user settings.
No schema changes needed to `transactions` or `postings` — this is pure workflow and UI.

Detection: an account "has a starting balance" when there exists a transaction with a posting against this account AND a posting against the configured `defaultEquityStartPath` account.

---

## Stories

### 1. Seed `equity:start` account and wire up user settings

Backend / DB.

- Add `defaultEquityStartAccountId uuid` (nullable FK → accounts) to `userSettings` schema —
  consistent with how `defaultOffsetAccountId` and `defaultConversionAccountId` are stored
- Generate and apply migration
- In `auth.ts` seeding hook: create `equity:start` alongside the existing defaults and
  set `defaultEquityStartAccountId` in the `userSettings` insert — same pattern as the others
- Update `accounts.test.ts`: the "returns only default accounts" test expects `equity:start`
  in the seeded list alongside `expenses:uncategorized` and `equity:conversions`
- Expose `defaultEquityStartAccountId` via `GET /api/user-settings` (automatic — full row is returned)
- Add `PATCH /api/user-settings` support for `defaultEquityStartAccountId` (same validation
  loop as the other account UUID fields)
- Add "Opening balances account" selector to the settings page UI (same pattern as the others)

### 2. Backend — starting balance status endpoint

Backend / accounts route.

- Add `GET /api/accounts/:id/starting-balance`
- Returns `{ hasStartingBalance: boolean, earliestTransactionDate: string | null }`
  - `hasStartingBalance`: true if any transaction has postings on both this account
    and the user's `defaultEquityStartAccountId` account
  - `earliestTransactionDate`: ISO date of the earliest transaction for this account
    (`MIN(transactions.date)` joined through postings)
- Used by the frontend to drive the warning state and default the date field

### 3. Assets page — account settings modal

Frontend / Assets page.

- Each account row gets a gear icon button (⚙) on the right
- Clicking it opens a modal titled "[account path] settings"
- Modal has a "Starting Balance" section:
  - If no starting balance: warning icon + "No starting balance" label
  - Date field: fetches `GET /api/accounts/:id/starting-balance` on modal open;
    if `earliestTransactionDate` is returned, defaults to one day before it;
    otherwise defaults to today
  - Equity account field: pre-filled from `userSettings.defaultEquityStartAccountId`
    (AccountPathInput — user can override per-account without changing the global default)
  - Amount field: text input, placeholder hint `255.25 CAD`
    (user types amount and currency together, e.g. "500 CAD" or "200.00 GBP")
  - "Set starting balance" confirm button
  - On confirm: POST to `/api/transactions` with the two-posting pattern,
    then re-fetch the starting balance status to update the warning state
