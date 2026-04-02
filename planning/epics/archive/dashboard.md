# Epic: Dashboard

A financial health dashboard inspired by tech ops dashboards — signal over noise, anomalies at a glance, and just enough forward-looking info to inform spending decisions without inducing anxiety.

## Design principles

- **Rearview vs windshield** — spending breakdown is a rearview mirror (what happened); cash position is a windshield (what's ahead). Keep them visually separated.
- **Delta over absolute** — "you spent 28% more than your average this month" is more actionable than "you spent $4,100".
- **Comfort zones, not countdowns** — runway shown as a band (comfortable / watch it / urgent), not a precise number of months.
- **No bank connections** — all data comes from manually entered/imported transactions already in the system.

## Layout (three panels)

```
[ This Month                    ]  [ Cash Position            ]
[ Rolling 12-month Spend History                              ]
```

---

## Stories

### Story 1 — Backend: spending summary endpoint

Add `GET /api/reports/spending-summary?from=&to=` that returns:
- Total spend for the period (sum of negative postings, excluding equity/conversion accounts)
- Breakdown by top-level expense category (e.g. `expenses:food`, `expenses:transport`)
- Each category: total amount, currency

This will require grouping postings by account path prefix. Only expense accounts (path starting with the configured expenses root, defaulting to `expenses`) are included. Return amounts per currency since the user is multi-currency.

### Story 2 — Backend: monthly spend history endpoint

Add `GET /api/reports/monthly-spend?months=12` that returns an array of `{ month: "2025-03", total: { CAD: "3200.00", ... } }` objects for the past N months. Same filtering rules as Story 1 (expense accounts only, exclude equity).

### Story 3 — This Month panel

Front-end panel showing:
- A header bar: total spent this month vs trailing 3-month average (show delta as +/- % with colour)
- A breakdown list of top expense categories, each as a labelled bar showing its share of total spend
- A date range control (reuse the pattern from the transactions page) so the user can shift the window

### Story 4 — Rolling spend history panel

Front-end panel showing a 12-month bar chart of monthly spend.
- Each bar is total spend for that month (combined across currencies, converted if needed — or stacked per currency if conversion is too complex for now)
- A horizontal line at the trailing average
- Bars above average are highlighted differently
- Built with Chart.js (`chart.js@4`) — used directly with a canvas element and `$effect`, no wrapper library

### Story 5 — Cash position panel

Front-end panel showing:
- Total liquid asset balances (reuse `fetchAccountBalances`, filter to assets root)
- Projected runway: trailing 3-month average burn ÷ total cash — shown as a comfort-zone indicator (green = >12mo, yellow = 6–12mo, red = <6mo) rather than a precise count
- Per-currency breakdown so multi-currency balances are visible

---

## Open questions

- **Currency consolidation for charts**: monthly spend bars will have mixed currencies. Options: (a) show per-currency stacked bars, (b) show only the user's default currency and skip others, (c) add an FX rate table later. Start with (a) — stacked bars, no conversion.
- **Expense root path**: hardcode `expenses` as the prefix filter for now; make it a user setting later if needed.
- **Date of "this month"**: use the current calendar month as default, not a rolling 30-day window, since monthly mental models are more natural for personal finance.
