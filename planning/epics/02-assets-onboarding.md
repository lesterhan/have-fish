# Epic: Assets Summary

Goal: Rename the Accounts page to Assets and display each asset account's current balance, driven by a configurable root path in user settings.

## Background

An account's balance = `SUM(amount) GROUP BY currency` across all its postings.
The Assets page shows all accounts whose path starts with the user's configured root
(default: `assets`). Leaf accounts are what's useful to display — roots like `assets:wise`
with no direct postings will show zero and can be filtered out.

---

## Stories

### 1. User settings — add `defaultAssetsRootPath`

Backend / DB.

- Add `defaultAssetsRootPath text` to `userSettings` schema, default `'assets'`
- Generate and apply migration
- Expose in `GET /api/user-settings` response
- Add "Assets root path" field to the settings page UI

### 2. Backend — account balances endpoint

Backend / new route.

- New endpoint: `GET /api/accounts/balances`
- Filters accounts by path prefix using `userSettings.defaultAssetsRootPath`
- Joins with postings to compute `SUM(amount)` per account per currency
- Returns: `[{ id, path, balances: [{ currency, amount }] }]`
- Excludes accounts with `deletedAt IS NOT NULL`

### 3. Frontend — Assets page

Frontend / rename + new UI.

- Rename the Accounts page (`/accounts`) to Assets (`/assets`); update nav link
- Fetch balances from the new endpoint on load
- Display each account as a row: path on the left, per-currency balances on the right
  (colored with `--color-amount-positive` / `--color-amount-negative`)
- Accounts with zero balance across all currencies can be shown dimmed or filtered out
  (decide during implementation)
- Existing account management (create/delete) can remain or move — decide during implementation
