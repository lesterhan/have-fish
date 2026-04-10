# Epic: FX Rates & Preferred Currency

**Goal:** Track daily FX rates (auto-fetched from frankfurter.app, no manual entry), store a preferred currency per user, and surface an exchange rate hint in the New Transaction modal when a posting's currency differs from the preferred one.

---

## Background

Rates are global (not per-user) — EUR/CAD on a given date is the same for all users.
The source is [frankfurter.app](https://api.frankfurter.app) — free, no API key, returns historical daily rates.

Rate lookup: `GET https://api.frankfurter.app/YYYY-MM-DD?from=EUR&to=CAD`

The hint in the modal is informational only — it does not auto-fill postings.

---

## Stories

### 1. FX rates table + fetch service (backend)

- Add `fxRates` table to schema:
  `id` (uuid pk), `date` (text YYYY-MM-DD), `baseCurrency` (text), `quoteCurrency` (text), `rate` (numeric 12,6), `createdAt` (timestamp)
  Unique constraint on `(date, baseCurrency, quoteCurrency)`.
- Write a `getOrFetchRate(date, baseCurrency, quoteCurrency)` service function:
  - Look up the DB first; if found, return the cached rate
  - Otherwise fetch from frankfurter.app, insert, and return
  - If the requested date is in the future or the API returns nothing, return `null`
- Add route `GET /api/fx-rates?date=YYYY-MM-DD&from=EUR&to=CAD`
  - Calls `getOrFetchRate`, returns `{ date, from, to, rate }` or 404 if unavailable
- Generate and apply migration (dev + test)
- One smoke test: rate for a known historical date round-trips correctly

### 2. Preferred currency in user settings (backend + frontend)

Backend:
- Add `preferredCurrency text default 'CAD'` to `userSettings` schema
- Generate and apply migration (dev + test)
- Expose `preferredCurrency` in the settings GET response
- Accept `preferredCurrency` in the settings PATCH handler

Frontend:
- Settings page: add a "Preferred currency" text input (uppercase, max 4 chars) below the existing account defaults
- Saves via the existing settings update flow

### 3. FX rate hint in AddTransactionModal (frontend)

- `settingsStore` already loads `preferredCurrency` — pass it into `AddTransactionModal` as a prop
- Derive a list of "foreign postings": postings whose currency ≠ `preferredCurrency` and have a parseable non-zero amount
- When foreign postings exist, fetch the rate for the modal's selected `date` for each unique foreign currency vs `preferredCurrency`
  - Debounce or fetch on date/currency change; show a loading state
- Render a hint row above the footer (below the balance row):
  `1 EUR = 1.5234 CAD · ≈ 152.34 CAD` (one line per distinct foreign currency)
  Style it as muted/secondary text — informational, not a form element
- If no rate is available for the date (weekend, holiday, future), show `rate unavailable for this date`
