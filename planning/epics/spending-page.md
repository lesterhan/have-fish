# Epic: Spending Page

Goal: A new "Spending" page in the sidebar that lets the user navigate month by month and interactively drill into expense categories through a chart. Top-level categories (e.g. `expenses:food`) are shown first; clicking one digs into its children (`expenses:food:groceries`, etc.).

## Background

The backend already has:
- `GET /api/reports/spending-summary?from=&to=` — returns per-category totals grouped at the two-segment level (`expenses:food`)
- `GET /api/reports/monthly-spend?months=N` — returns monthly totals, no breakdown

The spending page needs a drill-down capability: given a category prefix, return one level deeper. The chart type is TBD — a **horizontal bar chart rendered in SVG** (no library dependency, retro-friendly) is the starting point. We should expect to iterate on this as we implement.

---

## Stories

### 1. Backend — generalize spending-summary with `prefix` param

Backend / `routes/reports.ts`.

- Add an optional `prefix` query param to `GET /api/reports/spending-summary`
- When `prefix` is absent (existing behaviour): group by the first two path segments as today (`expenses:food` for `expenses:food:restaurant`)
- When `prefix` is provided (e.g. `expenses:food`): filter accounts to paths that start with `prefix:`, then group by one level deeper (`expenses:food:restaurant` for `expenses:food:restaurant:delivery`)
- Response shape is unchanged: `{ total, categories: [{ category, total }] }`
- Also include a `childCount` field per category entry — the number of distinct accounts whose path starts with `category:`. This lets the frontend show the `(3)` hint. A category with `childCount: 0` is a leaf.
- Add a route-level test covering: top-level call, drill-down call, leaf category (no children)

### 2. Sidebar nav — Spending link

Frontend / `Sidebar.svelte`.

- Add a "Spending" nav link between Dashboard and Transactions in `.top-nav`
- Follow the exact same markup pattern as the other nav links (icon + label, collapsed icon-only state)
- Add a `spending.svg` icon to `frontend/static/icons/` — a simple bar-chart icon drawn as a 16×16 SVG, matching the style of the existing icons (no fill, stroked lines or simple filled rects)

### 3. Page shell + month navigator

Frontend / new `frontend/src/routes/(authed)/spending/+page.svelte`.

- Page title via `HeadingBanner`: "Spending"
- Month navigator component (inline in the page for now):
  - Displays current month as "April 2026"
  - Prev / Next arrow buttons step one month at a time
  - Defaults to the current calendar month on load
  - Keyboard accessible (buttons, not divs)
- Currency picker: a simple `<select>` showing all currencies present in the data for the selected month; defaults to the first one alphabetically
- Below the navigator: a loading state (shimmer or "Loading…" text) while data fetches; an error state if the fetch fails
- No chart yet — just the shell, navigator, and currency picker wired up to state variables

### 4. Spending breakdown chart

Frontend / `spending/+page.svelte` + new `SpendingChart.svelte` component.

- Fetch `GET /api/reports/spending-summary?from=YYYY-MM-01&to=YYYY-MM-last&currency=<selected>` for the current month (construct dates from the month state)
- `SpendingChart.svelte` receives `categories: { category: string, amount: number, childCount: number }[]` and renders an SVG horizontal bar chart:
  - Each row: category label on the left, bar proportional to spend, amount on the right
  - Label shows the short name (strip the `expenses:` prefix) + `(N)` child count hint if `childCount > 0`
  - Bars colored with `--color-accent-mid`; the bar for the selected/hovered category highlighted
  - Click on a row fires an `onclick` callback with the full category path — the parent handles drill-down
  - No click affordance (cursor: default, no highlight) on leaf categories (`childCount === 0`)
  - Empty state: "No expenses recorded for this month."
- The chart is the full width of the page content area

### 5. Drill-down navigation + breadcrumb

Frontend / `spending/+page.svelte` + `SpendingChart.svelte`.

- Track a `drillPath = $state<string | null>(null)` — `null` means top level, a string like `"expenses:food"` means we're inside that category
- When a category bar is clicked: set `drillPath = clickedCategory`, re-fetch `spending-summary?prefix=drillPath&from=&to=`, update the chart
- Breadcrumb trail above the chart:
  - At top level: just "Expenses"
  - Drilled in: "Expenses › Food" (use the short segment names, title-cased)
  - Each breadcrumb segment except the last is a clickable link that navigates back to that level
  - Clicking "Expenses" at any depth returns to `drillPath = null`
- The chart title updates to reflect the current level: "All Expenses" at top, "Food" when drilled into `expenses:food`
- Leaf categories (no children) are not clickable — the cursor stays default and no drill happens
