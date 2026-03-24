# Epic: Split Transactions

Goal: Allow a single CSV import row to be split across multiple offset accounts and amounts, so one purchase can be categorised into several expense buckets simultaneously.

## Background

A Costco run might be $180 but span three categories:

| Account                   | Amount   | Currency |
|---------------------------|----------|----------|
| assets:rbc:chq            | −180.00  | CAD      |
| expenses:food             |  +90.00  | CAD      |
| expenses:household        |  +60.00  | CAD      |
| expenses:electronics      |  +30.00  | CAD      |

Currently the import flow assigns exactly one offset account per row. Splitting requires N offset postings that together sum to the original amount.

This is a UI-only change — the backend already supports arbitrary postings.

---

## Stories

### 1. Import preview — split row UI

Frontend / Import page.

- Each regular row in the preview table gets a "Split" toggle/button
- When split mode is active for a row, the single "To account" input becomes a list of (account, amount) pairs
- A running subtotal shows how much of the original amount is unallocated
- "Add split" appends a new row; splits can be removed
- The row is considered valid when all split amounts sum exactly to the original amount

### 2. Import commit — multi-posting regular rows

Frontend / Backend.

- When a row has splits, send multiple offset postings instead of one
- Backend commit route already handles N postings per transaction — confirm no changes needed
- Update `CommitTransaction` type in api.ts to support an optional `splits` array

### 3. Manual entry — split support

Frontend / Manual entry form (from Manual Transaction Entry epic).

- The multi-posting form from that epic already covers this case naturally
- Confirm the two epics compose cleanly; no duplication
