# Epic: Action Required

**Goal:** Surface transactions that need user attention — currently: missing FX rates for foreign-currency postings, and uncategorized transactions. Show a count badge on the account page filter button, and a red dot in the sidebar on affected accounts.

---

## Background

A transaction "needs action" if it meets **any** of these conditions (OR — more may be added later):
1. **Missing FX rate** — it has a posting in a currency other than `preferredCurrency`, and no `fx_rates` row exists for `(DATE(transaction.date), posting.currency, preferredCurrency)`.
2. **Uncategorized** — it has a posting to `defaultOffsetAccountId`.

Scope: all non-deleted transactions for the user, all time (not date-range filtered).

### Lazy-load strategy

The bulk summary (`/action-required-summary`) is fetched once in the layout and stored in a shared `actionRequiredStore`. This serves two consumers:
- **Sidebar** — reads counts from the store to show red dots, no extra fetch needed.
- **Account page** — reads its own count from the same store for the badge.

The full ID list (`/accounts/:id/action-required`) is only fetched on demand when the user clicks the filter button on the account page.

---

## Stories

### 1. Backend: per-account endpoint + bulk summary (bundled)

**`GET /api/accounts/:id/action-required`**
- Returns `{ count: number, transactionIds: string[] }` for the given account.
- Scoped to transactions that have at least one posting to account `:id`.
- Applies the OR conditions above, using `preferredCurrency` and `defaultOffsetAccountId` from the authenticated user's settings.

**`GET /api/accounts/action-required-summary`**
- Returns `{ accountId: string, count: number }[]` for all of the user's accounts.
- Same OR conditions, grouped by `anchor.account_id` — a transaction contributes to every account it touches.
- Only returns accounts with count > 0 (accounts with nothing to fix are omitted).

Both endpoints return empty/zero results gracefully when `defaultOffsetAccountId` or `preferredCurrency` are not set.

Tests: smoke test each endpoint.

### 2. Frontend: account page filter button

- On layout load, `actionRequiredStore.load()` fetches the bulk summary (once, shared).
- On the account page, read `actionRequiredStore.getCount(id)` for the current account:
  - Count > 0 → filter button shows warning icon + `"Action required (N)"`, styled with danger/warning colour.
  - Count === 0 → filter button shows a green checkmark + `"All clear"`.
  - Count unknown (store not yet loaded) → button shows neutral state, no badge.
- Clicking the button when count > 0:
  - If full ID list not yet fetched: call `GET /api/accounts/:id/action-required`, store the `transactionIds`.
  - Toggle the filter: when active, show only transactions whose ID is in `transactionIds`; when inactive, show all.
  - Button appearance reflects active filter state (use `variant="primary"` or similar).

### 3. Frontend: sidebar red dot

- `Sidebar.svelte` reads `actionRequiredStore.value` (already populated by layout load).
- For each account entry in the sidebar, if its ID appears in the store with count > 0, render a small red dot indicator next to the account name.
- No tooltip or count needed — just presence/absence of the dot.
- If the store hasn't loaded yet, render nothing (no flash of incorrect state).
