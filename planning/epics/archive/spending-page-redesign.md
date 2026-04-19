# Epic: Spending Page Redesign

**Design source:** `https://api.anthropic.com/v1/design/h/bMNvShdaIYcW6G1dX7rIfQ?open_file=Spending+v3.html`
Reference files in the bundle: `have-fish/project/src/v3-hybrid.jsx` (`V3MonthBar`, `V3Summary`, `V3Breakdown`, `V3BlockBars`).

**Depends on:** Graphite Design System, Currency Pill epics.

Goal: Overhaul the spending page layout and components to match the Spending v3 design: 3-column layout (sidebar | breakdown | transactions), redesigned month bar, summary cards in a grid, and block-character breakdown bars replacing the chart.

## Background

The current spending page uses:
- A header area with chips for Total Spend / vs Last Month / vs 3-Mo Avg
- A vertical stack of two panels: Breakdown (with SpendingChart) and Transactions
- Currency tabs on the Breakdown panel

The new design (from `v3-hybrid.jsx`) has:
- The sidebar on the left (unchanged component, but now part of the same page grid)
- A **main column** containing: MonthBar (top) → Summary cards (3-column grid) → Breakdown section
- A **right column** (360px fixed) for Transactions (covered in the Transactions Panel Redesign epic)
- All within a `display: grid; grid-template-columns: 1fr 360px` content area

The month bar: prev/next chevron buttons (XP-style toolbar buttons), serif month label, a **Convert** toolbar button (XP-style pressed/unpressed state). When Convert is active, a mono label `→ CAD · rates @ [date]` appears inline.

The summary row: three cards side by side (Total Spend / vs Last Month / vs 3-Mo Avg), each showing per-currency rows with `CurrencyPill` + mono amount. Total Spend card shows a `Σ TOTAL` row (dashed top border, accent color) when Convert is active.

The breakdown section: a dark section-bar header, currency tabs (XP-style), then `V3BlockBars` — a monospaced table with columns: CATEGORY | SHARE (block chars █▓░) | AMOUNT | %. The `SpendingChart` component is replaced entirely.

## Stories

### 1. Redesign the month bar

`frontend/src/routes/(authed)/spending/+page.svelte` — replace `.page-header` with `.month-bar`.

Layout: `display: flex; align-items: center; gap: 14px; padding: 14px 22px 10px; border-bottom: 1px solid var(--color-rule)`.

- Prev/next buttons: XP toolbar style — `background: linear-gradient(180deg, #fff, var(--color-rule-soft)); border: 1px solid var(--color-rule); border-radius: 3px; height: 24px; width: 24px`. Chevron glyphs `‹` `›` in `--color-accent`, serif font.
- Month label: `font-family: var(--font-serif); font-size: 24px; font-weight: 600; color: var(--color-text); letter-spacing: -0.2px`.
- Convert button: XP pressed/unpressed — when `converting` is false: white gradient bg, grey border, dark text; when true: `--color-accent` gradient bg, accent border, white text, `box-shadow: inset 0 1px 2px rgba(0,0,0,0.25)`. Label: `↻ Convert`.
- When `converting && !fxFetching`: add mono label `→ CAD · rates @ [date]` in `--color-accent`, font-size 10px.

### 2. Redesign the summary cards

`frontend/src/routes/(authed)/spending/+page.svelte` — replace `.chips-row` with `.summary-grid`.

Three-column grid (`grid-template-columns: 1fr 1fr 1fr`), separated by 1px `--color-rule` borders. No outer border — they sit flush in the panel.

Each card:
- Mono uppercase label (10px, 700, letter-spacing 1.2, `--color-accent`), margin-bottom 10px
- Per-currency rows: `CurrencyPill` on left, mono amount (18px, 600, tabular-nums) on right in a `grid: auto 1fr` row
- Delta cards (vs Last Month, vs 3-Mo Avg): amounts with `▲`/`▼` prefix (10px) and `--color-amount-negative`/`--color-amount-positive` colors, font-size 15px

Total Spend card — when `converting && convertedTotal !== null`: add a Σ TOTAL row below a `1px dashed --color-accent` separator:
- Left: `<span>` styled as `Σ TOTAL` badge (accent bg, white text, 9px mono, padding 2px 5px)
- Right: converted amount in `--color-accent`, 19px, 700

When `fxFetching`: show a spinner row instead of the Σ TOTAL row (same as current behavior).

### 3. Replace `SpendingChart` with block-character breakdown bars

New component: `frontend/src/lib/components/spending/SpendingBreakdown.svelte`.

This replaces `SpendingChart`. It receives the same `categories` array and `currency` prop.

Layout is a monospaced table with header row:
```
CATEGORY | SHARE | AMOUNT | %
```
Column widths (from `v3-hybrid.jsx`): `130px 1fr 110px 50px`, gap 12px.

For each category:
- Name column: category display name (strip `expenses:` prefix, show remainder). Clickable → calls `onclick(category.category)` prop for drill-down.
- Share column: block bar — `filled = round((pct / maxPct) * 22)` cells; render `'█'.repeat(filled) + '░'.repeat(22 - filled)`. Color: `--color-accent`. For refund rows (negative amounts): show `[REFUND  N%]` in `--color-amount-negative`.
- Amount column: right-aligned, tabular-nums, 600 weight. Prefix with a `<span style="opacity:0.55; font-size: 9px">{currency}</span>` badge.
- % column: right-aligned, `--color-text-muted`, 10px.

Total row: `= TOTAL` label, dashes for bar, total amount in 14px 700, 100%.

The section has a dark section-bar header above it (using `--color-section-bar-bg`, `--color-section-bar-fg`) reading "Breakdown · N txns", styled identically to the design's `V3Breakdown` header.

Currency tabs sit between the header bar and the bars table, exactly as they do today.

### 4. Wire up the new 3-column page layout

`frontend/src/routes/(authed)/spending/+page.svelte`.

The overall page content area (excluding the sidebar, which is part of the app shell) becomes:
```
display: grid;
grid-template-columns: 1fr 360px;
height: 100%;
overflow: hidden;
```

Left column: MonthBar (flex-shrink 0) → Summary grid (flex-shrink 0) → Breakdown section (flex 1, overflow auto).
Right column: Transactions panel (full height, see Transactions Panel Redesign epic).

Remove the existing `.page-header`, `.chips-row`, `.panels` CSS blocks and replace with the new layout.
