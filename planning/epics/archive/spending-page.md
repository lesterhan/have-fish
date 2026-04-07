# Epic: Spending Page

Goal: A dedicated "Spending" page for reviewing the previous month's expenses in detail. Shows a Chart.js horizontal bar chart of expense categories, with drill-down into subcategories and breadcrumb navigation back up. Currency selection works client-side — one fetch, no re-fetching on currency switch.

## Background

The dashboard already has a compact version of this: a "THIS MONTH" panel with a month navigator, category CSS bars, and a 3-month average. The spending page is that concept expanded to a full page, replacing the CSS bars with an interactive Chart.js chart and adding drill-down navigation.

The backend has:
- `GET /api/reports/spending-summary?from=&to=` — returns per-category totals grouped at the two-segment level, multi-currency. This is the only endpoint used by this page.

The spending-summary response already returns all currencies in the data:
```json
{ "total": { "CAD": "1200.00", "USD": "50.00" }, "categories": [{ "category": "expenses:food", "total": { "CAD": "400.00" } }] }
```
The currency picker is derived from `Object.keys(summary.total)` — no separate currency endpoint, no re-fetch on currency switch.

The page defaults to the **previous** calendar month (not the current month), since that's when transaction data is complete.

---

## Stories

### 1. Backend — add `prefix` and `childCount` to `spending-summary`

Backend / `routes/reports.ts`.

Add an optional `prefix` query param:

- **When absent** (existing behaviour): group by the first two path segments (`expenses:food` for `expenses:food:restaurant`). For each category, also compute `childCount` — the number of distinct accounts whose path starts with `category:` (i.e. has at least one more segment). A category with `childCount: 0` is a leaf.
- **When `prefix` is provided** (e.g. `expenses:food`): filter to accounts whose path starts with `prefix:`, then group by one level deeper (`expenses:food:restaurant` for `expenses:food:restaurant:delivery`). Compute `childCount` the same way relative to each grouped category path.

Updated response shape per category:
```json
{ "category": "expenses:food", "total": { "CAD": "400.00" }, "childCount": 2 }
```

No `currency` filter param — the response always returns all currencies; the frontend selects one client-side.

Test coverage: top-level call, drill-down call with `prefix`, leaf category (childCount 0).

---

### 2. Sidebar nav — Spending link

Frontend / `Sidebar.svelte`.

- Add a "Spending" nav link in `.top-nav`, between Dashboard and Transactions
- Follow the exact markup pattern of the other nav links (icon + label, collapsed icon-only)
- Add a `spending.svg` icon to `frontend/static/icons/` — a simple 16×16 bar-chart icon matching the style of existing icons

---

### 3. Page shell + month navigator

Frontend / new `frontend/src/routes/(authed)/spending/+page.svelte`.

- Page title via `HeadingBanner`: "Spending"
- Month navigator (same pattern as the dashboard's "THIS MONTH" panel):
  - Displays selected month as "March 2026"
  - Prev / Next arrow buttons, keyboard accessible
  - **Defaults to the previous calendar month on load**
- Currency picker: a `<select>` populated from `Object.keys(summary.total)`, defaulting to CAD. Hidden when only one currency is present.
- Loading and error states below the navigator
- No chart yet — just the shell, navigator, and currency picker wired to state

---

### 4. Spending breakdown chart (Chart.js)

Frontend / `spending/+page.svelte` + new `SpendingChart.svelte` component.

Fetch `GET /api/reports/spending-summary?from=YYYY-MM-01&to=YYYY-MM-last` for the selected month (no currency param — handle multi-currency client-side).

`SpendingChart.svelte` receives:
```ts
interface Props {
  categories: { category: string; total: Record<string, string>; childCount: number }[]
  currency: string
  onclick: (category: string) => void
}
```

Chart implementation:
- Chart.js horizontal bar chart: `type: 'bar'`, `indexAxis: 'y'`
- Follow the dashboard pattern exactly: `$effect()` + destroy/recreate on data/theme change, `theme.dark` reactive palette (WIN_COLOURS_LIGHT / WIN_COLOURS_DARK), Tahoma font at 11px, `cssVar()` for text/grid colors
- Labels: short name (strip the leading path segment, e.g. `food` from `expenses:food`) + `(N)` appended if `childCount > 0`
- Bars colored with the palette accent; sort categories by amount descending before rendering
- Click handler via Chart.js `options.onClick`: call `onclick` prop with the full category path. Only fire for categories where `childCount > 0` — leaf categories are non-clickable (cursor: default on hover)
- Tooltip shows full category path + amount + currency
- Empty state: "No expenses recorded for this month."

---

### 5. Drill-down navigation + breadcrumb

Frontend / `spending/+page.svelte`.

- `let drillPath = $state<string | null>(null)` — `null` = top level
- When a category bar is clicked: set `drillPath`, re-fetch `spending-summary?prefix=drillPath&from=&to=`, update the chart
- Changing the month or currency resets `drillPath` to `null`
- Breadcrumb above the chart:
  - Top level: "Expenses"
  - Drilled: "Expenses › Food › Restaurant" (each segment title-cased, split on `:`, skip the root `expenses` segment)
  - Every segment except the last is a clickable link — clicking it navigates back to that depth
  - Clicking "Expenses" resets to `drillPath = null`
- Chart title (passed to `SpendingChart`) updates to reflect the current level: "All Expenses" at top, "Food" when inside `expenses:food`
