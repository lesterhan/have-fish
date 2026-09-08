# Visual Language

An evolution of the token system, not a re-skin. This file is the specification and it is
self-contained: every value, ratio and rule needed to execute a story is in it.
`planning/exploration/visual-language/notes.md` is the working that produced it — the
measurements taken off the current code, and why each decision went the way it did. Read that
when a rule here looks arbitrary.

The mockups those two came from are not in the repo. They were drafted as a design canvas and
published as an Artifact; the tables below are what they encoded, and a mockup checked in beside
the code becomes a second source of truth for how the app looks the moment the real thing
diverges from it. Git history has them if a picture is ever wanted.

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
- **What gets deleted:** `CurrencyPill`'s 33-currency colour map; zebra striping on data rows;
  the legacy accent aliases
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

**Correction, found by story 1's assertions.** The `window-raised` row above measures its step
from the *case*, and those two steps (.045 / .105) diverge by 2.2x — the table asks for a
relationship its own values do not keep. Writing the assertion showed why: a case is always a
mid-tone between the desktop behind it and the panel inside it, so it sits below the window in
light and above it in dark, and forcing that pair's two steps to match would be asserting a
coincidence. The shipped ladder measures `window-raised` against `--color-window` instead, and
constrains the case↔window pair only to be a real step in each theme. No value changed.

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

## Core principles

Nine rules, numbered so a page story can cite them. Every page not drawn in the exploration is
adapted by applying these, not by guessing at what the mockups "meant". If a page needs
something none of these covers, that is a finding: write it down and add a rule rather than
making a local exception.

**V1 — One ladder, two themes.** Every surface belongs to a named rung, and an element sits on
the same rung in both themes. Adjacent rungs may differ between themes by up to 2× on ΔL, no
more. A colour that is not a rung does not go on a surface.

**V2 — Structure comes from bands and rules, not from container fills.** A fill within ΔL .04 of
its parent is decoration, not grouping — that is the `Card`-is-not-a-surface bug, and it is easy
to reintroduce. To group things, use the band rung (ΔL ≈ .10) or a rule (ΔL ≈ .115). A card that
needs to be seen needs a border and a shadow, not a paler fill.

**V3 — Exactly one loudest element per screen state.** Name it. Then name what it becomes in the
other states — a screen with outstanding work and a screen that is caught up do not have the
same loudest thing, and both need designing. If two elements compete, one of them is wrong.

*Refinement, found by story 8.* Read "screen" as **pane** where a route puts two independent
panes side by side. Fish Pie's group page is a ledger on the right and a form on the left, and
each genuinely leads with its own command — Save on an open expense, Add Expense on the form.
Forcing one accent-filled button across both would leave the other pane's command indistinguishable
from its Cancel, which is the defect V3 exists to prevent, not an instance of it. The rule still
bites *within* a pane: two competing commands in one pane is still one of them being wrong.

**V4 — Colour is scarce and it is semantic.** Four meanings, and no fifth: money in, money out,
attention, and the accent — which means *the one live thing*, the item you selected or the work
that needs you. Everything else is ink on a rung. A colour that appears on most rows has stopped
carrying information and become texture.

**V5 — Colour marks the minority.** Within any list, whichever sign dominates renders in primary
ink and the minus carries it; the exception gets the colour. This is what stops a ledger from
being a wall of red.

**V6 — Magnitude marks are ink, not accent.** Bars, coverage strips and any other length-encoded
mark use `--color-bar-ink` against `--color-rule` as the trough. Their contrast contract sits at
the fill/trough boundary — 3:1 there — not against the page, because the boundary is what
carries the value. Accent is reserved for the one mark you have selected.

*Scope, found by story 8.* V6 is about marks that **encode data**. A range control's filled
track encodes where its own handle sits — it is control state, and it keeps the accent, which is
why Fish Pie's split sliders were left alone. What does not survive is dimming that accent to
express *disabled*: opacity alone reads as grey on a cream track and as live orange on a
near-black one, so a disabled control names its own colour (`--color-text-disabled`) rather than
fading the live one. Same element, same rung, both themes — V1.

**V7 — Absence is designed.** A suppressed comparison, an unasserted coverage, a "never", an
empty result: each takes the slot it would have occupied and states the reason at the size of
the label it replaces. §4's caveat-loses rule means a caveat smaller than the number it
qualifies is not read, so the whole slot becomes the statement instead.

**V8 — One column geometry per screen.** Columns align down the entire page. A group heading is
a spanning row inside the sheet, never a table of its own. 33px rows.

**V9 — The case/work line does not move.** §2 still decides what is period and what is modern.
This epic changes how both are drawn, not which is which.

## Working page by page

The pass on each page is the same nine steps. Do them in order and the answer falls out; skip to
step 9 and you are pattern-matching against a mockup.

1. **Say the screen's question** in one sentence with no "and" (P5). Write it in the PR.
2. **Name the loudest element, per state** (V3). Most pages have at least two states worth
   designing — has outstanding work / is caught up, has data / is empty, filtered / unfiltered.
3. **Inventory surfaces.** Every distinct background on the page gets a rung. Anything that maps
   to no rung is either a mistake or a genuinely new rung — and a new rung needs a ΔL, a value in
   both themes, and an assertion, in that PR.
4. **Inventory ink.** Every text colour gets a rung or one of the four meanings (V4). Anything
   else becomes muted or faint.
5. **Check each list's sign distribution** and apply V5. This is per list, not per app: the same
   `MoneyDisplay` behaves differently on Accounts and on a ledger, and that is correct.
6. **Find the magnitude marks** and apply V6. Bars, strips, meters, sparklines, anything with a
   length.
7. **Find the absences** and apply V7.
8. **Settle the column geometry** (V8) — one grid, defined once, used by header, group bands and
   rows alike.
9. **Run the checklist** below, in both themes and at least two accents.

### Per-page checklist

Paste into the story's PR body and tick it. It is DESIGN.md §9 plus what this epic adds.

- [ ] The screen's question is stated, and the loudest element is named for every state
- [ ] Every surface on the page maps to a rung; no new rung without a ΔL and an assertion
- [ ] No raw colour anywhere — `bun test` guard passes
- [ ] Sign colour follows V5 for each list on the page, checked with real data, not one row
- [ ] Magnitude marks use bar ink; accent appears at most once per screen
- [ ] Every absence has a designed slot that says why
- [ ] One column geometry; columns align from the first group to the last
- [ ] Correct in light and dark, and in at least two accents including ochre and persimmon
- [ ] Interaction count for the page's primary action is unchanged or lower
- [ ] Nothing broken below 768px
- [ ] Screenshots in the PR: both themes, and the page's other state

## Keeping the app working

The migration is several PRs long and the app is in daily use between them, so the sequencing
matters more than the design does.

**Story 1 changes token values, not token names.** Nothing imports differently, nothing fails to
compile, and no component needs editing. That makes the blast radius purely visual and bounded
to the places that bypass the tokens — which are now enumerated, not hypothetical:

| file | what it hard-codes |
|------|--------------------|
| `ui/CurrencyPill.svelte` | a 33-currency colour map, light-theme only, applied as an inline style that overrides the token fallback. Every money row in the app carries one, so in dark theme these are pale stickers on a dark page — the largest theme-parity break in the app, and `tokens.test.ts` cannot see it because it is not a token. |
| `fish-pie/GroupRightPanel.svelte` | `#e8a000` and `#8a5500` — a warning amber that will not move with the theme |
| `routes/(authed)/settings/+page.svelte` | a `#5a2020 → #2a0808` section bar |
| `ui/Toggle.svelte`, `ui/Checkbox.svelte` | white-topped Aqua gloss gradients, cool and light-only |
| `ui/ChromeButton.svelte` | `#ff8080` on the close button |
| `AccentPicker.svelte` | `#ffffff` label |
| `routes/+layout.svelte` | the `#007070` login desktop gradient |

All of them are fixed in story 1, because after story 1 they are the only things in the app that
can look wrong.

**A guard test replaces vigilance.** A source-level test — the pattern `tokens.test.ts` and
`chromeButtons.test.ts` already use — fails on a raw colour in any `.svelte` file outside a
named allowlist. Without it a nine-PR migration drifts, and the drift is invisible until someone
opens the wrong page in the wrong theme.

**A page is migrated whole or not at all.** No flags, no parallel systems, no "the table is done
but the header isn't". §6 already forbids two ways of doing the same thing; a half-migrated page
is that, inside one file.

**Order is by blast radius, not by preference.** Tokens, then accents, then the guard, then pages
in the order they are actually opened. Every page story is independently shippable and leaves the
app coherent — a page on the new geometry beside a page that has only had the token change is
consistent, because they are drawn from the same ladder.

**Walk the app after every story.** The token change is global, so a page story can only regress
its own page structurally, but any story can regress any page visually. One pass through every
route in both themes, at the end of each PR.

## Page inventory

What each page is likely to need, so no story starts from a blank page. Every one of these gets
the nine steps above.

| page | what will bite |
|------|----------------|
| `accounts` | drawn in the exploration — one sheet, state-dependent position header, flags column, selection off the leading column |
| `account/[id]` | drawn — the ledger sign rule (V5), day bands, date suppression, the coverage strip on bar ink |
| `spending` | drawn — bar ink, the drilled category as the only accent, the suppressed comparison slot, currency tabs on the band |
| `budgeting` | unvisited. Verify whether it draws its own bars; if so V6 applies. Likely has the same three-tile problem the position header solves. |
| `catch-up` | `CoverageStrip` is the app's other magnitude mark and already has its own contrast contract — reconcile it with V6 rather than leaving two |
| `transactions` | the ledger pattern again; also carries the modal nesting §10 flags, which is out of scope here and should not be quietly fixed inside a visual PR |
| `import` | 1777 lines and the most surfaces of any route — preview tables, step chrome, sort UI. Budget it as two stories, and do not grow the file. |
| `fish-pie` | `GroupRightPanel` at 1266 lines plus the hard-coded amber; the most likely place for a genuinely new rung to be needed |
| `settings` | the hard-coded danger section bar, and `AccentPicker`, which is the one surface where all six accents appear at once |
| `login` / `signup` | the desktop gradient and the case with no session — the only place the frame is seen nearly empty |

## Stories

**1 — The ladder.** Replace the surface and ink values in both themes with the tables above; add
`--color-bar-ink`; rename `--color-coverage-hatch` to `--color-incomplete` and migrate its call
sites; delete the legacy accent aliases. Fix all seven hard-coded sites listed above — making
`CurrencyPill` token-based and neutral, which is the smallest change that is never wrong in
either theme; whether currency keeps a derived identity hue is a separate question, deliberately
deferred. Add the raw-colour guard test. Extend `tokens.test.ts` with a `deltaL` helper, the
surface-step assertions and the ink assertions. Update DESIGN.md §5 and strike the Nord
reference. No page layout changes at all: this story is measured by every page looking different
and none of them looking broken.

**2 — Accents on one rung.** Regenerate `ACCENTS` from hue plus fixed lightness, with `chipBg`,
`chipFg` and the titlebar gradient derived rather than authored. Twelve assertions.

**3 — Accounts.** One sheet with fixed column geometry replacing a `<table>` per group. Group
bands as spanning rows. 33px rows. Flags in the flags column or the column goes. Selection off
the leading column. The state-dependent position header, which lands here because this is the
page that needs it first and becomes a shared pattern afterwards.

**4 — The ledger pattern.** `account/[id]` and `transactions`. V5's sign rule as a shared helper
threaded through `MoneyDisplay`, day bands carrying the day's net, date suppression within a
run. Delete the zebra striping here. Do not touch the modal nesting — that is §10's item and its
own epic.

**5 — The chart pattern.** `spending` and `budgeting`. Bar ink, accent only on the drilled
category, the incomplete hatch, and the suppressed-comparison slot. Reconcile `CoverageStrip`'s
existing contrast contract with V6 so there is one rule for magnitude marks rather than two.

**6 — Catch Up.**

**7 — Import.** Two stories if the surfaces demand it; split the route rather than growing it.

**8 — Fish Pie.**

**9 — Settings, login and the sweep.** The remaining hard-coded surfaces, `AccentPicker` with all
six accents on one rung, and one pass through every route in both themes at the end.

Also carries a naming debt story 8 turned up and deliberately did not fix locally: twenty-six
call sites paint a **form error** with `--color-amount-negative`. The value is right and the name
is a lie — an invalid field is not money out, and V4's four meanings have no slot for it. This is
one rename plus an alias, worth nothing as a one-file change and worth doing once across the app;
either widen V4 to name *invalid* as a fifth meaning or say explicitly that it shares money-out's
red, but say which.

Stories 3–9 are independent once 1 and 2 land, and each is shippable on its own.

## Known boundary

The system has no answer for a **multi-series categorical chart**, because the app has none —
§10 records that the monthly spend series does not exist. When one lands it needs a validated
categorical ramp, which cannot be derived from this ladder and must not reuse the status colours
or the accent. That is its own piece of work, and inventing it now would be inventing a palette
for a chart nobody has built.

## The companion is deferred, by decision

`mobile/` has its own theme and no access to `tokens.css`. §8 asks for a token's meaning to move
with it in the same epic; that is being consciously relaxed here, because the companion is a
different device with a different case metaphor and no urgency to match. What stays binding is
the half of §8 that is about meaning rather than appearance: **same concept, same name, same sign
convention, same semantics for green, red and amber.** The companion may be a different colour;
it may not disagree about what a colour means. When it does adopt, it adopts the ladder — the ΔL
targets and ratio contracts are platform-independent — not these hexes.
