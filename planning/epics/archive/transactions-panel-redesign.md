# Epic: Transactions Panel Redesign

**Design source:** `https://api.anthropic.com/v1/design/h/bMNvShdaIYcW6G1dX7rIfQ?open_file=Spending+v3.html`
Reference files in the bundle: `have-fish/project/src/v3-hybrid.jsx` (`V3TxnPanel`, `V3TxnRow`, `V3TxnFooter`).

**Depends on:** Graphite Design System, Currency Pill, Spending Page Redesign epics.

Goal: Redesign the transactions panel on the spending page from the current `<Panel>` wrapper into a native-list right column that integrates with the Graphite shell.

## Background

The current transactions panel is a `<Panel title={txnPanelTitle}>` with a flat list of `<TransactionRow>` components. In the new design it is a fixed 360px right column with:
- A dark section-bar header (`--color-section-bar-bg` gradient) with "Transactions · N entries" and a "VIEW ALL" button
- A filter chips toolbar (ALL / per-currency chips) and a sort indicator
- A column header row (DATE | PAYEE / ACCOUNT | AMOUNT) in mono uppercase
- Striped transaction rows with alternate background (`--color-window` / `--color-window-raised`)
- Each row: two-line payee block on left (payee name in `--color-accent` underlined with dotted decoration; account path in 10px mono muted), date block on far left, currency pill + amount on right
- When Convert is active: a small `= {amount} CAD` line beneath each non-base-currency amount
- Footer: "SHOWING N / TOTAL" on left, page total on right (converts to CAD when active)

The existing `TransactionRow` component is used on other pages (transactions list, account view). **Do not modify it.** Build a new `SpendingTxnRow.svelte` specifically for the spending panel.

## Stories

### 1. Section bar header and panel scaffold

`frontend/src/routes/(authed)/spending/+page.svelte` — replace the `<Panel title={txnPanelTitle}>` with a new `.txn-panel` div.

Panel scaffold:
```
display: flex; flex-direction: column; height: 100%; overflow: hidden;
background: var(--color-window-raised);
border-left: 1px solid var(--color-rule);
```

Header bar:
- Dark gradient bg: `var(--color-section-bar-bg)`, fg: `var(--color-section-bar-fg)`
- Padding `6px 14px`, serif font 14px 700
- "Transactions" label + `{txns.length} entries` in 11px 400 mono opacity 0.75
- Spacer flex: 1
- "VIEW ALL" link button → navigates to `/transactions` with the current month's date range as query params

### 2. Filter chips toolbar

Inside `.txn-panel`, below the header bar.

- "FILTER" label: 10px mono, muted, letter-spacing 1
- One chip per available currency in `summary.total` plus an "ALL" chip at the start
- Active chip: `--color-accent` bg, white text. Inactive: white bg, `--color-rule` border
- Chip style: `padding: 2px 8px; border-radius: 2px; font-family: mono; font-size: 10px; font-weight: 700`
- Spacer + `↑↓ DATE` sort label (visual only for now — sorting is already date-desc from the API)

State: `let txnFilter = $state<string>('ALL')`. When filter changes, filter `txns` in the template: `txns.filter(tx => txnFilter === 'ALL' || tx.currency === txnFilter)`.

### 3. Column header and striped transaction rows

New component: `frontend/src/lib/components/spending/SpendingTxnRow.svelte`.

Props:
```ts
interface Props {
  tx: Transaction
  idx: number          // for stripe: even = --color-window-raised, odd = --color-window
  converted: boolean
  fxRates: Record<string, number>  // e.g. { EUR: 1.49, GBP: 1.74 } — passed down from page
  baseCurrency: string             // the user's preferredCurrency
}
```

Row layout (`display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; padding: 7px 14px; border-bottom: 1px solid var(--color-rule)`):

- Date column (52px): day-of-week in 9px mono muted uppercase; date in 10px mono bold dark
- Payee/account column: payee in 13px `--color-accent` 600 weight, dotted underline offset 2px; account path in 10px mono muted (strip `assets:` prefix, show arrow `→`, strip `expenses:` prefix from destination)
- Amount column (right-aligned, flex-column):
  - `<CurrencyPill code={tx.currency} size="xs" />` + amount in 13px mono 700 tabular-nums
  - When `converted && tx.currency !== baseCurrency`: small `= {cadEquiv} {baseCurrency}` in 10px mono `--color-accent`

The CAD equivalent: `(Math.abs(parseFloat(tx.amount)) * (fxRates[tx.currency] ?? 1)).toLocaleString(...)`. Note the fxRates here are the same rates fetched by the existing `startConversion()` logic; pass them down from the page once fetched.

Column header row (above the list, below the toolbar): `DATE | PAYEE / ACCOUNT | AMOUNT` in 9px mono uppercase muted, same grid template.

### 4. Footer with page total

`V3TxnFooter` equivalent at the bottom of `.txn-panel`.

Layout: `display: flex; align-items: center; padding: 8px 14px; border-top: 1px solid var(--color-sidebar-border); background: linear-gradient(180deg, #fff, var(--color-rule-soft))`.

- Left: `SHOWING {filtered.length} / {txns.length}` in 9px mono muted
- Right (when `!converted`): `scroll for more →` in 10px mono muted
- Right (when `converted`): `page total` label + page-total amount in 13px mono `--color-accent` 700

Page total = sum of `Math.abs(parseFloat(tx.amount)) * (fxRates[tx.currency] ?? 1)` across all filtered rows.
