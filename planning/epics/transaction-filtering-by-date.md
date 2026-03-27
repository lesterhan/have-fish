# Epic: Transaction Filtering by Date

Goal: Replace the full transaction dump on the transactions page with a filter Panel that controls what gets fetched and displayed by date range.

## Context

The transactions page currently fetches all transactions and renders them in one go. With historical data this will be large. This epic adds a date filter Panel and extends the backend to support date range query params.

## Decisions

- **V1 scope**: date range only. Account filtering deferred (needs separate UX design).
- **Filter execution**: server-side — filters become query params on `GET /api/transactions`. No client-side filtering.
- **Filter state**: lives in the URL as search params, so the view is bookmarkable and shareable.
- **Default state**: previous 1 month from today, applied on load.
- **Custom date parsing**: hand-rolled parser, no library. Keeps error handling predictable — invalid input fails loudly. Format set is small enough that a regex-based approach (~40-60 lines) covers all supported inputs.

## Stories

### 1. Backend: date range filtering on `GET /api/transactions`

Extend the existing route to accept `?from=YYYY-MM-DD` and `?to=YYYY-MM-DD` query params and filter the result set accordingly. Both params are optional and independent.

- [ ] Add `from` and `to` query param parsing in `transactions.ts`
- [ ] Apply `gte(transactions.date, from)` / `lte(transactions.date, to)` to the Drizzle WHERE clause when present
- [ ] Write tests: no params (all returned), `from` only, `to` only, both, date that matches nothing

### 2. Frontend: filter state in URL

Wire the transactions page to read `?from` and `?to` from the URL and pass them to `fetchTransactions()`. Changing the filter updates the URL; navigating back/forward restores it.

- [ ] Update `fetchTransactions()` in `api.ts` to accept optional `from` and `to` params and append them to the query string
- [ ] On page load, read `from`/`to` from `$page.url.searchParams`; if absent, default to previous 1 month (today minus 30 days → today)
- [ ] When filters change, use `goto()` with `replaceState: true` to update the URL without pushing a history entry mid-edit, then push a real entry on apply

### 3. Frontend: `DateRangeSelector` reusable component

A reusable date range input component modelled on metrics platform UX (Datadog-style). Intended to be used anywhere in the app that needs date filtering — not specific to the transactions page.

The component presents a dropdown of preset windows. Selecting "Custom..." reveals a permissive free-text input that accepts natural-language and ISO-style strings.

**Preset options:**
- Past 1 day
- Past 1 week
- Past 1 month *(default)*
- Past 3 months
- Custom...

**Custom input parsing** — the input should accept at minimum:
- Relative shorthand: `2 weeks`, `6mo`, `90d`, `3 months`
- ISO date range: `2026-02-20 to 2026-03-08`
- Single ISO date (treated as from-date, to = today): `2026-01-01`

**Component contract:**
- [ ] Create `DateRangeSelector.svelte` in `lib/components/`
- [ ] Props: `value: DateRange`, `onchange: (range: DateRange) => void` where `DateRange = { from: string, to: string }` (always resolved to ISO dates before emitting)
- [ ] Dropdown defaults to "Past 1 month"; selecting a preset immediately emits the resolved range
- [ ] "Custom..." reveals a text input; parsed on blur or Enter — show an inline error if unparseable, do not emit
- [ ] The resolved `from`/`to` are always `YYYY-MM-DD` strings regardless of how the user entered them

### 4. Frontend: Filter Panel component

A raised Panel above the transactions table embedding `DateRangeSelector` and an Apply button.

- [ ] Create `FilterPanel.svelte` in `lib/components/`
- [ ] Props: `from: string`, `to: string`, `onApply: (from: string, to: string) => void`
- [ ] Embeds `DateRangeSelector` — the panel holds the pending selection state until Apply is clicked
- [ ] Apply button commits the selection and triggers `onApply`; does not auto-fetch on every change
- [ ] Reset button returns `DateRangeSelector` to "Past 1 month" and fires `onApply` immediately
- [ ] Wire into `transactions/+page.svelte`
