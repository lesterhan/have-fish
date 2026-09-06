# Visual Language

An evolution of the token system, not a re-skin. The exploration that produced it is
`planning/exploration/visual-language/notes.md`; the boards are the `.dc.html` files beside
it. Read those before story 1 — this file is the specification, they are the evidence.

The one-sentence version: **an element occupies the same rung in both themes.** Today it does
not, and that is the root of most of what is wrong.

## UX brief

- **Question this screen answers:** none — this epic changes how every screen is drawn, not
  what any of them says.
- **Inbox role:** it promotes the existing one. The count of what needs you becomes the loudest
  element on a screen when it is non-zero, and yields to the money when it is zero.
- **Primary action + interaction count:** unchanged everywhere. No flow gains or loses a step;
  if one does, the story is wrong.
- **Case or work:** both. §2's line does not move — the case stays period and the work stays
  modern — but both are re-rendered on one ladder.
- **Existing patterns reused:** `Card`, `SectionCard`, `TableShell`, `GradientButton`,
  `MoneyDisplay`, `CurrencyPill`, the coverage strip, the block-bar breakdown, `tokens.test.ts`
  as the enforcement mechanism.
- **Patterns being stretched or replaced:** `SectionCard`'s per-group `<table>` is replaced by
  one sheet with fixed column geometry. The always-on selection column is replaced. The
  four-tile position row is replaced by a state-dependent position header.
- **What gets deleted:** zebra striping on data rows; the legacy accent aliases
  (`--color-accent-mid`, `--color-accent-light`, flagged in §10 since the Graphite epic); the
  per-group `<table>`; the `FLAGS` column header that stood over an empty column.

## Why

Measured against `tokens.css` and component source, not screenshots:

- `--color-section-bar-bg` is 11.45:1 against the page in light and 1.24:1 in dark — ΔL 0.549
  against ΔL 0.009. The same element is the loudest thing on one screen and one of the quietest
  on the other, so hierarchy is a property of the theme rather than of the design.
- `--card-bg` is `--color-window` and the page is `--color-window-raised`: 1.06:1 light, 1.05:1
  dark. The surface primitive contributes no figure/ground anywhere in the app.
- `--color-rule` is 1.24:1 against the card in dark. With the band invisible and the card
  invisible, dark has neither surface nor line carrying grouping. It reads flat because it is.
- `--color-amount-negative` is 3.05:1 in dark against positive's 6.13:1 — below the 4.5 floor
  §8 sets, on the app's most important datum, and asymmetric between its two states.
- Four of six accents fail 4.5:1 in light. Ochre is 2.64:1 light and 9.52:1 dark.
- Light is 2003 Aqua and dark is Nord, a 2016 editor theme. There was no dark Mac OS X, so the
  dark theme had no period referent and borrowed one.

## The system

### Rule 1 — surfaces step by apparent lightness, ink steps by ratio

At the dark end a perceptually equal step produces a tiny WCAG ratio, which is precisely why
today's dark theme flattened. So surfaces are specified as OKLCH ΔL between adjacent rungs, and
only ink keeps the contrast-ratio contract. Both are assertable against the token file.

### Rule 2 — the same element sits on the same rung in both themes

A step may differ between themes by up to 2×, no more (the dark end genuinely needs a larger ΔL
to look equal). Today's worst case is 61×.

### Rule 3 — colour marks the minority sign

Found by drawing a 24-row ledger. On Accounts one or two rows are negative; on a transaction
list nearly all of them are, and 22 red numbers reads as 22 errors rather than as ordinary
spending. So in any list where one sign dominates, the dominant sign renders in primary ink and
the minus carries it — §5 already says the minus is what carries the sign — and colour is spent
on the minority sign, which is the row you were actually looking for. A liability *balance* is
likewise not an error and does not take `--color-amount-negative` on that ground alone.

### Rule 4 — accent means "the one live thing", so it cannot fill a chart

`SpendingBreakdown` currently colours every block bar with `--color-accent`. If accent marks
what needs you and what you have selected, it cannot also be the fill for nine categories at
once. Magnitude marks take a neutral `--color-bar-ink`; accent marks only the category you have
drilled into. The page stays monochrome and the accent keeps meaning something.

### Surfaces — warm graphite, hue 88, chroma 0.014

Warm putty rather than Apple's cool silver: the same era by way of SGI, NeXT and Sun. Two
alternates are drawn on the `Hues` board if this is revisited.

| token                    | light     | dark      | steps from | ΔL light / dark |
|--------------------------|-----------|-----------|------------|-----------------|
| `--color-desktop`        | `#a8a49b` | `#100d07` | —          | —               |
| case (titlebar/status)   | `#d3cfc5` | `#3b3730` | desktop    | .135 / .179     |
| `--color-window-raised`  | `#e2ded4` | `#211e16` | case       | .045 / .105     |
| `--color-window`         | `#f6f1e7` | `#2d2a22` | raised     | .060 / .050     |
| `--color-section-bar-bg` | `#c1bdb4` | `#3f3b33` | raised     | .100 / .120     |
| `--color-rule`           | `#d0ccc2` | `#4b473f` | window     | .115 / .116     |

The case gradient runs `#f4f0e6 → #d3cfc5` in light and `#504d45 → #3b3730` in dark; the
sidebar is `#d8d4ca` / `#302d26`; the inset trough `#fffdf6` / `#191710`.

### Ink — ratio against `--color-window`

| token                     | light     | dark      | light | dark  |
|---------------------------|-----------|-----------|-------|-------|
| `--color-text`            | `#221f17` | `#ece7dc` | 14.62 | 11.62 |
| `--color-text-muted`      | `#615d54` | `#a9a49a` |  5.83 |  5.77 |
| `--color-text-disabled`   | `#6e6a60` | `#989389` |  4.79 |  4.69 |
| `--color-amount-positive` | `#137738` | `#6ec283` |  5.01 |  6.62 |
| `--color-amount-negative` | `#be222a` | `#f47b74` |  5.40 |  5.41 |
| `--color-warning`         | `#8a5600` | `#dfa651` |  5.47 |  6.62 |

Two new tokens, both found by the stress test:

| token                 | light     | dark      | contract                              |
|-----------------------|-----------|-----------|---------------------------------------|
| `--color-bar-ink`     | `#66635a` | `#9c988f` | ≥3:1 against `--color-rule` (the trough) |
| `--color-incomplete`  | `#8a857a` | `#6a6459` | renames `--color-coverage-hatch`, which already did this job for the coverage strip and now covers any incomplete magnitude mark |

### Accents — six kept, all on one rung

Regenerated at fixed lightness (light L 0.520, dark L 0.695, chroma capped 0.115) with each
accent's own hue preserved. All twelve land in 4.65–5.47 against `--color-window`.

| accent      | light     | dark      | was (L / D)   | now (L / D)  |
|-------------|-----------|-----------|---------------|--------------|
| `aqua`      | `#2d6ca8` | `#64a2e0` | 4.10 / 6.62   | 4.88 / 5.31  |
| `sage`      | `#39794a` | `#6eae7d` | 3.68 / 7.95   | 4.65 / 5.47  |
| `persimmon` | `#9d5128` | `#d38763` | 3.46 / 7.22   | 5.12 / 5.06  |
| `plum`      | `#8b4f8b` | `#c085c0` | 5.44 / 5.75   | 5.20 / 5.02  |
| `ochre`     | `#866300` | `#bc973e` | 2.64 / 9.52   | 4.91 / 5.21  |
| `slate`     | `#5c6a7b` | `#909faf` | 5.06 / 6.46   | 4.91 / 5.30  |

`chipBg`, `chipFg` and the titlebar gradient derive from the same hue at fixed offsets rather
than being hand-picked per accent — that hand-picking is where the spread came from.

## Stories

**1 — Put the ladder in `tokens.css`.** Replace the surface and ink values in both themes with
the tables above, add `--color-bar-ink`, rename `--color-coverage-hatch` to
`--color-incomplete` and migrate its call sites, and delete the legacy accent aliases. No
component changes: every value is already a token, so this story is measured by the app looking
different and nothing breaking. Extend `tokens.test.ts` with a `deltaL` helper, the surface-step
assertions (each rung within its band, and neither theme more than 2× the other on the same
step), and the ink assertions (every rung ≥4.5:1 in both themes; positive and negative within
25% of each other). Update DESIGN.md §5 to describe the ladder, and strike the Nord reference.

**2 — Accents on one rung.** Regenerate `ACCENTS` in `accent.ts` from hue + fixed lightness, with
`chipBg`/`chipFg`/`titlebar` derived rather than authored. Twelve assertions — one per accent per
theme — in `tokens.test.ts`.

**3 — The Accounts sheet.** One table with fixed column geometry replacing a `<table>` per
group, so the balance column stops wandering between Cash, Equity and Liabilities. Group bands
become a spanning row on the ladder's band rung. 33px rows. Flags render in the `Flags` column
or the column goes. Selection moves off the always-on leftmost column; the leading column
carries the account's state instead.

**4 — The position header.** Replace the four equal tiles with one dominant figure and
subordinates on a shared baseline, and make which figure is dominant depend on state: work
outstanding leads when the count is non-zero, the money leads when it is zero and the cleared
state reads as the win condition §4 asks for. Each figure keeps its own as-of.

**5 — Colour marks the minority sign.** A shared helper deciding the tone for a list given its
sign distribution, threaded through `MoneyDisplay`, and applied to the account detail ledger,
the transactions list and the spending transaction column. Delete the zebra striping in the
same story — the hairlines already separate rows at ΔL .115, so the stripe is a second answer to
a solved question.

**6 — Chart ink.** `SpendingBreakdown` bars take `--color-bar-ink` with `--color-rule` as the
trough and accent reserved for the drilled category. The incomplete hatch uses
`--color-incomplete`. Give a suppressed comparison a designed slot that keeps the row's rhythm
and states the reason, rather than an absence.

Stories 3–6 are independent once 1 and 2 land.

## Known boundary

The system has no answer for a **multi-series categorical chart**, because the app has none —
§10 records that the monthly spend series does not exist. When one lands it needs a validated
categorical ramp, which cannot be derived from this ladder and must not reuse the status colours
or the accent. That is its own piece of work, and inventing it now would be inventing a palette
for a chart nobody has built.

## Untested

The mobile companion (`mobile/`) has no access to `tokens.css` and carries its own theme. §8
requires the vocabulary to move with it: when story 1 lands, the companion's theme changes in
the same epic or the two surfaces disagree about what a colour means.
