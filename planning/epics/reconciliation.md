# Epic: Reconciliation

Goal: Let users reconcile an account's ledger balance against the real account balance, and record a correction posting when they diverge.

## Background

Over time a ledger drifts from reality: rounding errors, missed transactions, mystery fees. A reconciliation workflow lets the user confirm "my ledger says X, my bank says Y, the difference is Z" and post an adjustment:

| Account              | Amount  | Currency |
|----------------------|---------|----------|
| assets:rbc:chq       |  −0.03  | CAD      |
| equity:adjustments   |  +0.03  | CAD      |

The offset account (`equity:adjustments`) is configurable via user settings (similar to `defaultEquityStartPath`).

---

## Stories

### 1. User settings — add `defaultAdjustmentsPath`

Backend / DB.

- Add `defaultAdjustmentsPath text` to `userSettings`, default `'equity:adjustments'`
- Generate and apply migration
- Expose in settings API and settings page UI

### 2. Backend — account balance at a point in time

Backend / accounts route.

- Extend (or add) an endpoint that returns the computed ledger balance for an account up to a given date
- Used to pre-fill the "ledger balance" field in the reconciliation form

### 3. Reconciliation form

Frontend / Assets page.

- Each account row gets a "Reconcile" action
- Form: statement date, statement balance (what the bank says), currency
- UI shows: ledger balance as of that date, statement balance, difference
- If difference is non-zero, user can confirm to post an adjustment transaction
- Adjustment uses `defaultAdjustmentsPath` as the offset account
