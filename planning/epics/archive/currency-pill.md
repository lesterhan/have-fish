# Epic: Currency Pill Component

**Design source:** `https://api.anthropic.com/v1/design/h/bMNvShdaIYcW6G1dX7rIfQ?open_file=Spending+v3.html`
Reference files in the bundle: `have-fish/project/src/v3-hybrid.jsx` (`CcyPill` function), `have-fish/project/src/v3-accents.jsx` (`chipBg`/`chipFg` per accent).

**Depends on:** Graphite Design System epic (accent chip tokens must exist).

Goal: Replace emoji flag usage throughout the app with a compact 3-letter currency code pill, matching the design's `CcyPill` pattern.

## Background

The current codebase uses `currencyFlag(code)` (emoji flags) to represent currencies. The design replaces these with a tinted pill: a small inline chip showing the 3-letter code in a background derived from the accent color's `chipBg`/`chipFg`. These read cleanly in data-dense layouts without the emoji rendering inconsistency across platforms.

Design reference for the pill (from `v3-hybrid.jsx`):
```
<CcyPill code="CAD" />
→ inline-flex, 9px bold mono text, padding 2px 5px,
  background: --color-accent-chip-bg,
  color: --color-accent-chip-fg,
  border: 1px solid --color-accent-chip-fg (at low opacity),
  border-radius: 2px,
  line-height: 1
```

A `size` prop supports `"xs"` (slightly smaller, used in transaction rows) and default.

## Stories

### 1. Build `CurrencyPill.svelte` component

`frontend/src/lib/components/ui/CurrencyPill.svelte`.

Props:
```ts
interface Props {
  code: string        // 3-letter currency code, e.g. 'CAD'
  size?: 'xs' | 'sm' // 'sm' is default
}
```

Markup: a `<span>` with inline-flex layout, mono font, `--color-accent-chip-bg` background, `--color-accent-chip-fg` text color, 1px border at 30% opacity of `--color-accent-chip-fg`, `border-radius: 2px`. Text is `code.toUpperCase()`.

For `size="xs"`: font-size 9px, padding 1px 4px.
For `size="sm"` (default): font-size 10px, padding 2px 5px.

### 2. Replace `currencyFlag()` in the spending page

`frontend/src/routes/(authed)/spending/+page.svelte`.

Replace every `{currencyFlag(c) ? `${currencyFlag(c)} ` : ''}{c}` pattern with `<CurrencyPill code={c} />`. This covers the summary chips row (total spend, vs last month, vs 3-mo avg).

### 3. Replace currency display in `TransactionRow.svelte`

`frontend/src/lib/components/transactions/TransactionRow.svelte`.

Currency is currently shown as a plain text code. Replace with `<CurrencyPill code={tx.currency} size="xs" />`.

### 4. Update sidebar account balance display

`frontend/src/lib/components/Sidebar.svelte`.

The account balance lines currently show `{b.currency} {formatCompact(b.amount)}`. Replace the currency portion with `<CurrencyPill code={b.currency} size="xs" />`. Keep `formatCompact(b.amount)` for the number.
