# Visual language pass — 2026-09-06

A design pass in the sense of `DESIGN.md` §7: a critique, not a refactor. Nothing here has
shipped. The boards are `.dc.html` artboards; `canvas.json` lays them out. The seeded canvas
is gitignored because it carries a ~2 MB editor payload — reseed it from these files.

## What the critique found

Every number below came from `tokens.css` or component source, not from a screenshot.

**The hierarchy is a property of the theme, not the design.** `--color-section-bar-bg` is
11.45:1 against the page in light and 1.24:1 in dark. In apparent lightness that is ΔL 0.549
against ΔL 0.009 — a 61× difference in the same element's step. It is the loudest thing on the
light page and one of the quietest on the dark one.

**`Card` is not a surface.** `--card-bg` is `--color-window` and the content area is
`--color-window-raised`: 1.06:1 in light, 1.05:1 in dark. Every panel in the app is separated
from the page by a hairline and a shadow, and nothing else.

**Dark has nothing left to carry structure.** `--color-rule` is 1.24:1 against the card. With
the band invisible and the card invisible, dark reads flat because it has neither surface nor
line doing the grouping.

**Losses are dimmer than gains in dark.** `--color-amount-negative` (#bf616a) is 3.05:1 — below
the 4.5 floor §8 sets — while `--color-amount-positive` is 6.13:1. The two halves of the app's
most important datum are not equally legible.

**Four of six accents fail 4.5:1 in light.** Ochre is 2.64:1 light and 9.52:1 dark; the six
range over 2.64–5.44 in light and 5.75–9.52 in dark.

**Columns do not line up between groups.** Each `SectionCard` renders its own `<table>` at
`width: 100%` with no fixed layout, so every group sizes columns from its own content and the
balance column sits at a different x in Cash, Equity and Liabilities.

**Light is 2003 Aqua; dark is Nord.** A 2016 editor theme with its own opinions. There was no
dark Mac OS X, so the dark theme had no period referent and borrowed one.

Also, smaller: the inbox count — the thesis of the product — is a chip in a filter bar three
rungs down; red means both "you owe this" and "this data is stale"; `FLAGS` is a column header
over an empty column while the flag renders under the date; twenty always-visible checkboxes
own the leftmost column for an action taken once a session; and the trust readout is set as the
smallest, lowest-contrast text on the page.

## The fix: a contrast ladder

**An element occupies the same rung in both themes.** Surfaces step by apparent lightness
(OKLCH ΔL), because at the dark end a perceptually equal step produces a tiny WCAG ratio — which
is exactly why today's dark theme is flat. Ink keeps the ratio contract. Both are assertable in
`tokens.test.ts` against the token file, the way the coverage strip already is.

Surfaces, warm graphite (hue 88, chroma 0.014):

| rung    | light     | dark      | step from | ΔL light / dark |
|---------|-----------|-----------|-----------|-----------------|
| desktop | `#a8a49b` | `#100d07` | —         | —               |
| case    | `#d3cfc5` | `#3b3730` | desktop   | .135 / .179     |
| well    | `#e2ded4` | `#211e16` | case      | .045 / .105     |
| panel   | `#f6f1e7` | `#2d2a22` | well      | .060 / .050     |
| band    | `#c1bdb4` | `#3f3b33` | well      | .100 / .120     |
| rule    | `#d0ccc2` | `#4b473f` | panel     | .115 / .116     |

Ink, ratio against the panel:

| rung      | light     | dark      | light | dark  |
|-----------|-----------|-----------|-------|-------|
| primary   | `#221f17` | `#ece7dc` | 14.62 | 11.62 |
| muted     | `#615d54` | `#a9a49a` |  5.83 |  5.77 |
| faint     | `#6e6a60` | `#989389` |  4.79 |  4.69 |
| positive  | `#137738` | `#6ec283` |  5.01 |  6.62 |
| negative  | `#be222a` | `#f47b74` |  5.40 |  5.41 |
| attention | `#8a5600` | `#dfa651` |  5.47 |  6.62 |
| accent    | `#0d64ac` | `#58b6ea` |  5.43 |  6.34 |

Accents regenerated at fixed lightness (light L 0.520, dark L 0.695, chroma capped at 0.115)
with each accent's own hue preserved — all twelve land in 4.65–5.47:

| accent    | light     | dark      | was (L / D)  | now (L / D)  |
|-----------|-----------|-----------|--------------|--------------|
| aqua      | `#2d6ca8` | `#64a2e0` | 4.10 / 6.62  | 4.88 / 5.31  |
| sage      | `#39794a` | `#6eae7d` | 3.68 / 7.95  | 4.65 / 5.47  |
| persimmon | `#9d5128` | `#d38763` | 3.46 / 7.22  | 5.12 / 5.06  |
| plum      | `#8b4f8b` | `#c085c0` | 5.44 / 5.75  | 5.20 / 5.02  |
| ochre     | `#866300` | `#bc973e` | 2.64 / 9.52  | 4.91 / 5.21  |
| slate     | `#5c6a7b` | `#909faf` | 5.06 / 6.46  | 4.91 / 5.30  |

## Decisions taken

- **Direction A**, warm graphite. The period reference stays; the hue leaves Apple's cool
  silver for the putty grey of SGI, NeXT and Sun. The ladder is what makes hue free: rotate it
  and every step and ratio above is unchanged. Two alternates are drawn on `Hues.dc.html`.
- **33px rows**, against ~50 today.
- **Six accents kept**, constrained to one rung as above.
- **The loudest element depends on state.** Work outstanding: the count leads. Caught up: the
  money leads and the cleared state reads as the win condition §4 asks for.
- **One table, one column geometry** across all groups, replacing a `<table>` per group.

## Still open

- Which grey family. Warm graphite ships in the boards; instrument grey and slate violet are
  drawn beside it.
- Whether the constrained accents still read as the six colours they name — persimmon and ochre
  moved furthest.
- Whether leading the Accounts page with the chore count is right on an ordinary day, or only
  defensible because the caught-up state is its payoff.

## Boards

`Main` / `MainLight` / `Cleared` — Accounts in Direction A, three states.
`Hues` — the same fragment in three grey families, both themes.
`Accents` — six accents before and after, and in place.
`Ladder` — the ladder as a token contract, with the assertions that hold it.
`Diagnosis` — the critique with the numbers on it.
`DirectionB` / `DirectionC` — the two directions not taken, kept for reference.
