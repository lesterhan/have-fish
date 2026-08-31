# Epic: Account Page Redesign

**Design source:** `https://claude.ai/code/artifact/dcc7e2ae-aaa9-408f-a73e-498bc8bcc3b6`
Page **"Direction A"** is the target: `Main.dc.html` is the layout, `Palette.dc.html` is the
colour spec. Page **"Not chosen"** keeps directions B (inspector rail) and C (quiet page) for
the record — see "Directions not taken" below.

**Depends on:** Catch-Up Coach (ships `CoverageStrip`, which story 3 reshapes).

Goal: Make the account page readable at a glance. Today five full-width bands stack above the
first transaction, every control carries the same visual weight, and the accent colour is spent
on the least important text on the screen. This epic establishes a hierarchy — one loud thing,
one warm thing, everything else grey — and reclaims roughly 240px of vertical space for the
ledger itself.

## Background

The account page has accumulated features without a layout that can absorb them. Measured on a
1548×616 window, the first transaction row starts ~390px down the page. Above it sit the account
header, the coverage card, the toolbar, the "Transactions · N entries" section bar, and the
column header — five bands, four of them chrome.

Three specific problems:

**1. The coverage panel does not belong to the page.** Every other region is a flat full-bleed
band separated by a 1px rule. Coverage is a `Card` — rounded, bordered, drop-shadowed — stretched
edge to edge, so it gets the corners and shadow of a floating object without the margin that
would make it read as one. It also brings a second dark section bar, which then competes with the
Transactions bar directly beneath it.

**2. The accent is spent on the wrong things.** Every transaction description renders in
`--color-accent` with a dotted underline, so a screenful of descriptions is the loudest thing on
the page. Meanwhile the balance — the number you opened the page for — is plain `--color-text` at
18px, smaller than the account name above it and no more prominent than a toolbar button.

**3. The toolbar cannot say which control matters.** Ten controls render as the same grey
gradient chip: search, sort, flagged, date range, reset, new, reconcile, settings, Quick Entry,
currency convert. Three of them are 14px glyphs with no label. Their real frequencies differ by
orders of magnitude — New is daily, Quick Entry per-session, Reconcile monthly, Settings rare —
and nothing in the row reflects that. The currency toggle, which only changes how the list reads,
sits at the end of the action cluster as if it were an action.

## Design decisions

Recorded because they are judgement calls, not conventions:

- **The balance wins by size, not colour.** A credit-card balance of 3,759 is normal; painting it
  `--color-amount-negative` reads as an alarm that is not going off. It goes to 30px and stays
  `--color-text`, and the direction moves into the label as a word (`OWING · CAD`).

- **Amount colour by exception.** On a credit-card account every row is an expense, so the
  existing negative-is-red convention produces a wall of red carrying no information. Expenses
  render `--color-text` bold; `--color-amount-positive` marks money coming back. Red stays
  available for the genuinely wrong. Transfers keep their existing neutral directional colours.
  **This is a deliberate departure from the amount-display convention in `CLAUDE.md`, scoped to
  `AccountTransactionRow` only** — the transactions list and spending page are unaffected.

- **The toolbar splits down the middle.** Left is what you are *looking at* (sort, range, count,
  currency view); right is what you can *do* (Quick Entry, New, More). Two groups that mean
  different things can carry priority; one undifferentiated row cannot.

- **At most one amber region above the list**, and it disappears entirely when the count is zero.
  A disabled control that exists to say "nothing to report" is still a control.

## Stories

### 1. De-accent the ledger row

`frontend/src/lib/components/transactions/AccountTransactionRow.svelte` — used only by the
account page, so nothing else is affected.

- `.description`: drop `color: var(--color-accent)` and the dotted underline at rest; render
  `var(--color-text)`. Restore the dotted underline under `.row:hover .description` so the row
  still reads as clickable.
- Amount emphasis: add an `emphasis?: boolean` prop to `MoneyDisplay.svelte` (weight 700, and
  the tone below). Do **not** restyle `MoneyDisplay` globally — `TransactionRow` uses it too.
- Amount tone, in a new pure `frontend/src/lib/components/transactions/amountTone.ts`:
  - transfer → existing `--color-transfer-in` / `--color-transfer-out`, unchanged
  - non-transfer, `parseFloat(amount) > 0` → `--color-amount-positive`
  - otherwise → `--color-text`
- Apply the same rule to `.fx-main-amount` (already weight 700) in place of its flat
  `--color-text`.

Tests: unit-test `amountTone` — expense, refund, zero, transfer in, transfer out, and a
malformed amount string.

### 2. The balance wins the page

`frontend/src/lib/components/accounts/AccountHeading.svelte`.

- `.balance-amount`: 18px → 30px, weight 600 → 700, keep `tabular-nums`. Mobile (≤520px): 22px.
- `.balance-label`: `--color-accent` → `--color-text-muted`. The accent is not for labels.
- The currency moves *into* the label (`OWING · CAD`) and the inline `CurrencyPill` comes off the
  amount line — a pill next to a 30px number competes with it. Multi-currency accounts render one
  balance item per currency, so each item's label still names its own currency.
- Label and sign, in a new pure `frontend/src/lib/components/accounts/balanceLabel.ts`, keyed off
  `account.resolvedType`:
  - `liability` + negative → label `OWING · {CUR}`, amount rendered as magnitude (no `−`)
  - `liability` + positive → label `IN CREDIT · {CUR}`, magnitude
  - anything else → label `BALANCE · {CUR}`, existing signed rendering
  - `resolvedType` null (atypical root, no override) → falls through to `BALANCE`

Tests: unit-test `balanceLabel` across those four branches plus a zero balance.

### 3. Coverage: card becomes a status line

- `frontend/src/lib/components/catch-up/CoverageStrip.svelte`: add `compact?: boolean` — 10px day
  height, no month ruler, no legend. (`showLegend` already exists; `compact` also drops the
  ruler row and shrinks `.day`.)
- Account page: delete the `<Card class="coverage-card">` block and its `.coverage-*` styles.
  Replace with a flat `.status-line` band — `background: var(--color-window-raised)`,
  `border-bottom: 1px solid var(--color-rule)`, height 32px, `padding: 0 var(--sp-lg)`. No
  radius, no shadow, no second dark bar.
- Contents, left to right: a 240px compact strip, the status sentence, and a `Coverage ⌄`
  disclosure. Expanding renders the full-size strip (ruler + legend, `compact={false}`) in a band
  below, in place — same component, no modal.
- Status copy, in a new pure `statusLine(coverage, today)` beside the other catch-up helpers,
  returning `{ text, daysOpen }`:
  - no intervals → `Nothing recorded yet`
  - `intervals[0].throughDate >= horizon` → `Current` (+ ` · next statement {nextHorizon}` when
    present) — same wording as today
  - otherwise → `Covered through {throughDate} · {n} days open`, where `n` is the inclusive day
    count between `throughDate` and `horizon`

Tests: unit-test `statusLine` — no intervals, current, current with next statement, behind by
several days, and a gap of exactly one day (singular "day", not "days").

### 4. The attention chip moves to the status line

- `FilterPanel.svelte`: remove the action-required button and the `actionRequiredCount` /
  `actionRequiredActive` / `onActionRequiredToggle` props. The account page is its only consumer
  (the transactions page never passes them), so this is a deletion, not a gate.
- Account page: render the chip at the right end of the `.status-line` band — pill shaped
  (`--radius-pill`), amber gradient, warning icon, `{n} need attention`. It toggles
  `actionRequiredActive` exactly as today.
- **Zero flagged → no chip at all.** Today that state renders a disabled check button.
- Drop the `warning-pulse` animation for this instance. A 1.8s infinite halo is a lot on a page
  you sit and read; the amber fill carries the signal on its own. The `attention` prop on
  `GradientButton` stays for other callers.

Tests: the count/visibility decision is a one-liner — cover it in whatever pure helper the band
ends up with, or fold it into `statusLine`'s test file.

### 5. Toolbar: split "looking at" from "can do"

Account page toolbar + `GradientButton.svelte`.

- **Left group** — sort toggle, `DateRangeSelector`, then muted mono text
  `{from} → {to} · {n} entries`, then the currency convert toggle (moved here from the ops
  group; it changes how the list reads, not what happens to it).
  - The date field keeps its preset label (`3 months`) — it is a text input you type presets
    into, so the label is the affordance. The resolved dates ride alongside it as muted text,
    which is what removes the two-date-vocabularies problem (`3 months` in the toolbar vs
    `Covered through Jun 20` in the status line).
- **Right group** — `Quick Entry`, then `＋ New` as the single primary, then a `···` More menu
  holding `Reconcile` and `Account settings`.
- `GradientButton`: add `variant="primary"` — accent gradient, accent border, `--color-accent-fg`
  text. Visually this matches the existing `active` state, but `active` sets `aria-pressed` and
  means "toggled on", which is wrong for a command button. Separate variant, shared look.
- `GradientButton`: add `quiet?: boolean` — no border or gradient at rest, both arriving on
  hover. Used by the account toolbar's icon buttons only, so no other page changes.
- New `frontend/src/lib/components/ui/MoreMenu.svelte`: `···` trigger plus a popover using
  `--shadow-window` and `--radius-lg`, 12px labelled rows with icons. Closes on outside click and
  on Escape; the trigger takes focus back on close.
- **Remove the reset button.** It is a permanent 24px slot for a one-click path to a value that
  is already the first item in the date dropdown, and its clock glyph does not read as "reset".
  In its place, `DateRangeSelector` grows a clear `×` *inside* the field, shown only when the
  current range is not the default preset — an affordance that exists only when there is
  something to clear.
- The `N entries` count moves here from the section bar, which story 6 then deletes.

Tests: unit-test the muted range text builder (default preset vs custom range, and the
singular/plural on entries). `MoreMenu` open/close is a component concern — a smoke test is
enough if it fits the existing frontend test setup.

### 6. Retire the Transactions section bar

- Delete `.section-bar` and `.section-bar-title` from the account page.
- Promote `.tx-col-header` to carry the dark treatment: `--color-section-bar-bg`,
  `--color-section-bar-fg`, `--color-section-bar-border-top` / `-bottom`, height 26px. Column
  labels stay mono 9px 700.
- Two bands become one. Chrome above the first transaction should land at roughly 154px, down
  from ~390px.

Verify in a real browser at 1548×616 and at 520px before closing the story — three of the four
bugs found while drawing these mockups were only visible in a screenshot.

## Out of scope

- **Description search.** The account page deliberately does not pass `onAccountPathChange` to
  `FilterPanel` — you are already scoped to one account, so path filtering is redundant. There is
  no free-text description search on this page today, and adding one is a feature, not a
  redesign.
- **`Export journal` in the More menu.** Drawn in the mockup, but it waits on the
  [hledger Journal Export](hledger-export.md) epic.
- **The `AccountSettings` inline panel.** Opening it from the More menu still expands a panel
  that pushes the transaction list down. Left alone here; worth revisiting if it starts to grate.
- **`TransactionRow`, the transactions list, and the spending page.** Every change in stories 1–2
  is scoped to `AccountTransactionRow` / `AccountHeading` or lands behind a new opt-in prop.

## Directions not taken

Both are kept on the design canvas's "Not chosen" page.

- **B · Inspector rail** — move everything that is not a transaction into a 300px right rail, so
  new features become rail sections instead of new bands. It is the option that scales best, and
  the app already reaches for the pattern (`QuickEntryPanel` is a 400px rail). Rejected for now
  because it costs 300px of width permanently and needs a collapse story on narrow windows.
  Worth revisiting if the page really does take on several more features.
- **C · Quiet page** — keep today's bands, restyle only. Fixed the priority problem but left the
  vertical stack alone, so the next feature would still land as another band.
