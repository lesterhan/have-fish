# Epic: Spending Page — Account Filter

Goal: Add a source account filter to the Spending page so the user can narrow the spending breakdown to transactions that came from a specific account (e.g. `liabilities:visa`).

## Background

The spending-summary endpoint currently aggregates all expense postings for a user in a date range, regardless of which account the money came from. This is fine for a high-level view, but for reviewing a credit card statement or a specific bank account's spending, the user needs to filter by source.

In the double-entry model, "source account" means: find all transactions that have a posting on account X, then show the expense side of those transactions.

## Stories

### 1. Backend — add `sourceAccountId` filter to `spending-summary`

Backend / `routes/reports.ts`.

- Add an optional `sourceAccountId` query param (a UUID)
- When provided, restrict results to transactions that include a posting on that account:
  ```sql
  AND transactions.id IN (
    SELECT DISTINCT p2.transaction_id FROM postings p2
    WHERE p2.account_id = $sourceAccountId AND p2.deleted_at IS NULL
  )
  ```
  In Drizzle this is an `inArray` on `transactions.id` using a subquery.
- Validate that the account belongs to the requesting user before using it (prevent cross-user queries)
- Response shape unchanged
- Test: seed a transaction on `liabilities:visa → expenses:food` and another on `assets:chq → expenses:food`; confirm that filtering by the visa account ID only returns the first

### 2. Frontend — account picker on the Spending page

Frontend / `spending/+page.svelte`.

- Fetch the user's accounts on mount (reuse `fetchAccountBalances` or a simpler accounts fetch)
- Show a `<select>` in the controls row: "All accounts" (default, no filter) + one option per asset/liability account, sorted by path
- When an account is selected, pass its `id` to `fetchSpendingSummary` as `sourceAccountId`
- Changing the account resets `drillPath` to `null` and re-fetches
- Update `fetchSpendingSummary` in `api.ts` to accept an optional `sourceAccountId` param and include it in the query string
