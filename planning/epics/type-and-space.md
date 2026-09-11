# Type & Space Scale

The Visual Language epic put every surface and every ink on one argued ladder. Type and
space never got the same treatment. They have scales — seven type rungs, seven space rungs —
but the app does not use them, and the reason is not discipline.

**The scales start above where the app lives.**

`--text-xs` bottoms out at 12px. The app's chrome — section bar labels, column heads, key
caps, tick labels, avatar initials — renders at 9, 10 and 11px. There is no rung down there,
so 127 of the 160 raw pixel font sizes in the codebase are below the smallest token. Not
people ignoring the scale. People reaching for a rung that does not exist.

`--sp-xs` bottoms out at 8px. Of the 470 raw pixel values in spacing declarations, 313 are
below it — 1, 2, 3, 4, 5, 6, 7px, the gaps inside a control or between a glyph and its
label. Same hole, same result.

## The census

Taken 2026-09-09 across 101 components, style blocks only, comments stripped.

**Type** — 303 declarations use a token, 160 use a raw pixel value, across 52 of the 101
components. Fifteen distinct raw sizes:

| | 7 | 8 | 8.5 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 18 | 19 | 22 | 24 | 30 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rules | 1 | 3 | 1 | 35 | 56 | 31 | 3 | 15 | 4 | 1 | 2 | 1 | 2 | 4 | 1 |

The token side is just as lopsided: `--text-xs` (157) and `--text-sm` (127) carry 284 of the
303 uses. The other five rungs share 19 between them. A seven-rung scale being used as a
two-rung scale, with three untokenized rungs underneath it.

Note what 9 and 10px actually are: 27 of 35 and 47 of 56 are **mono**, and about half are
uppercase. That is not "small text", it is a distinct register — the label voice — that the
scale has no name for.

**Space** — 590 token uses, 470 raw pixel atoms, 18 distinct:

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 14 | 16 | 18 | 22 | 24 | 28 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| atoms | 31 | 69 | 58 | 66 | 45 | 36 | 8 | 36 | 2 | 25 | 28 | 35 | 2 | 3 | 23 | 1 | 1 |

Two things in there are not noise. The sub-8px cluster is one register the scale is missing.
And **14 and 22** are the other: they are the house gutters — the distance from a panel's
edge to its content — and they sit between rungs, so they are written out by hand 58 times.
`Empty` has an `inset` prop taking a *string*, whose entire job is to let a caller say `22px`
because there is no token for it. A component accepting a magic number as a prop is the scale
failing in the most visible way it can.

**The small vocabularies**, which have no tokens at all or lie about themselves:

- `font-weight` — 63 raw `700`, 53 `var(--weight-semibold)`, 21 raw `600`, plus `bold`,
  `normal`, `500`. And `--weight-semibold` is **defined as 700**, which is bold. Semibold is
  600, which 21 declarations want and no token provides. The token is misnamed, so half the
  app spells the same value the other way.
- `letter-spacing` — no tokens. Fourteen distinct values mixing px and em; 0.4, 0.5, 0.6 and
  0.8px are all doing one job (tracking on uppercase mono labels).
- `line-height` — three tokens, used 6 times. Raw `1` appears 23 times, plus 1.05, 1.15, 1.3,
  1.4, 1.45, 1.5. `--leading-none` does not exist and is the most-wanted value in the app.

**The document disagrees with the stylesheet.** DESIGN.md §5 says "Lucida Grande at small
sizes — 13–14px base." `base.css` sets `html { font-size: var(--text-base) }` = 16px. Neither
is the truth: the app's actual working register is 12px and 14px, and its label register is
10px. Nothing anywhere says so.

**The rule that just shipped, half-applied.** `base.css` now owns the section bar so it can
only be defined once — and `.section-bar-title` hard-codes `font-size: 10px`,
`font-weight: 700` and `letter-spacing: 0.6px`, because there is no token for any of the
three. The one global class this design system has is the one place it cannot cite itself.

## The diagnosis

This is the colour problem one rung down, and it has the same cause and the same fix.

Colour drifted because a scoped `<style>` block cannot share a rule, so writing it again was
always the shortest path. Type and space drift because the scale does not reach the app, so
writing a number is always the shortest path. In both cases the individual decision is
correct and the aggregate is a mess.

The colour epic fixed it by naming rungs for **what they are** rather than where they sit —
`--color-section-bar-bg`, not `--color-grey-3`. The type scale is still named by t-shirt size,
and that naming is now actively lying: `--text-xs` is not the app's extra-small, it is the
app's single most-used size. Calling the workhorse "extra small" is precisely why someone
reaching for a *genuinely* small label writes `10px` — xs is taken.

## UX brief

- **Question this screen answers:** none — no screen changes. This is the vocabulary every
  screen is written in.
- **Inbox role:** none.
- **Primary action + interaction count:** unchanged.
- **Case or work:** both, and that is the point — the label register is case furniture and
  the reading register is the work, and one scale currently has to serve both without saying
  which rung is which.
- **Existing patterns reused:** the ladder argument from §5, and the guard-test arrangement
  from `no-raw-colour.test.ts` — one file owns a category of values, one test stops it
  leaking.
- **Patterns being stretched or replaced:** the `--text-*` scale is replaced (role names, new
  rungs at the bottom). The `--sp-*` scale is extended downward, not renamed. `--weight-*` is
  corrected. `--tracking-*` and `--leading-none` are new.
- **What gets deleted:** `Empty`'s `inset` prop and all 9 call sites that pass it; the
  hard-coded type in `base.css`'s `.section-bar-title`; `--text-3xl`, which has zero uses.

## Proposal

Two ladders, and they are deliberately **asymmetric** — one gets renamed and one does not.

### Type: renamed by role, extended at both ends

Nine rungs, one job each. Sizes stay in `rem` with the px in a comment, as the file already
does, so a reader's browser font setting still scales the app (§8).

| token | px | family | job |
|---|---|---|---|
| `--text-display` | 28 | mono | the one number a page is about — an account's balance |
| `--text-title` | 22 | serif | page and object titles |
| `--text-figure` | 18 | mono | a card's headline amount, a panel's heading |
| `--text-amount` | 16 | mono | money in a row — `MoneyDisplay`'s size |
| `--text-body` | 14 | sans | the reading register — rows, prose, inputs |
| `--text-dense` | 12 | sans | secondary text inside a dense row |
| `--text-control` | 11 | mono | text inside an interactive control |
| `--text-label` | 10 | mono | uppercase chrome labels — section bars, column heads |
| `--text-micro` | 9 | mono | the smallest legible mark — key caps, ticks, initials |

Nine is more than the seven this epic was first scoped with, and the two extra rungs are the
epic's first two findings — both cases of a census being read as drift when it was a register.

**11px is the control register.** The first draft proposed splitting its 31 rules between 10
and 12 by font family. Reading them instead of counting them: `GradientButton`, `TabStrip`,
`CurrencyInput`, `Select`, `AccountPathInput`, `DateRangeSelector`, `QuickEntryPanel`'s
fields, `AccountPicker`'s rows. That is not drift, it is the size text takes when it sits
inside something you interact with, and collapsing it resizes every button, tab, input and
select in the app.

**16px is money in a row.** `--text-base` looked nearly dead at 6 uses, but one of them is
`MoneyDisplay`, which is every amount the app renders in a list. Folding it into 14 would have
moved every money row to make the ladder one rung shorter.

`--text-3xl` really is dead — zero uses anywhere — and is deleted.

Four rungs one pixel apart (9, 10, 11, 12) is uncomfortable and is the thing to check in the
browser rather than argue on paper: whether the uppercase-label voice at 10 and the control
voice at 11 are two rungs or one. The rest of the collapses are deliberate:

- **13px → 14** (15 rules). 13 and 14 are one register pretending to be two.
- **15 → 16**, **19 → 18** (2 rules). `.card-amount` at 18 and `.card-sigma-amount` at 19 sit
  on the same spending page. Nobody chose a 1px difference.
- **24 → 22** (4 rules), **30 → 28** (1), **7, 8, 8.5 → 9** (5).
- **`--text-xl` (20) and `--text-2xl` (24) → `--text-title` (22)** (7 uses).

### Space: extended downward, kept as it is

The `--sp-*` names are not lying — `--sp-xs` at 8px really is this app's extra-small *gap*.
590 declarations use them correctly. Renaming them buys nothing and risks 590 silent changes,
so: add rungs below, add the gutters, leave the rest alone.

| token | px | job |
|---|---|---|
| `--sp-hair` | 1 | a border's worth — optical nudges, icon offsets |
| `--sp-3xs` | 2 | inside a chip, between a glyph and its label |
| `--sp-2xs` | 4 | inside a control |
| `--sp-xs` … `--sp-3xl` | 8 … 64 | unchanged |
| `--gutter-tight` | 10 | dense panel edge |
| `--gutter` | 14 | the house gutter — list rows, most panels |
| `--gutter-wide` | 22 | a card's breathing edge |

3, 5, 6 and 7px round to 2, 4 or 8 — 147 declarations moving by 1–2px, which is the part that
has to be *looked at* rather than reasoned about.

### The small vocabularies

```
--weight-normal: 400        (unchanged)
--weight-medium: 500        (unchanged)
--weight-semibold: 600      corrected — was 700, which is bold
--weight-bold: 700          new; the 53 existing var(--weight-semibold) uses move here

--tracking-tight: -0.2px    negative tracking on large mono figures
--tracking-label: 0.6px     uppercase mono labels — the one that matters
--tracking-wide: 1px        the widest, for the sparsest labels

--leading-none: 1           new, and the most-used value in the app
--leading-tight: 1.2        (unchanged)
--leading-snug: 1.35        new — absorbs 1.3, 1.4, 1.45
--leading-normal: 1.5       (unchanged)
--leading-loose: 1.75       (unchanged)
```

The weight change is the one with teeth: `--weight-semibold` is redefined from 700 to 600,
so every existing use has to be repointed at `--weight-bold` **in the same commit**, or 53
places quietly get lighter.

## Stories

1. **Draw both ladders.** `tokens.css` gains the rungs and the corrected names; `tokens.test.ts`
   gains assertions — every rung distinct, ordered, and the type ladder's steps stated. No
   component changes, so the diff is the argument.
2. **The small vocabularies.** Weight, tracking, leading. Includes the mechanical
   `--weight-semibold` → `--weight-bold` repoint, which must land with the redefinition.
3. **The label register.** The 122 declarations at 9/10/11px move onto `--text-label` and
   `--text-micro`. `base.css`'s `.section-bar-title` stops hard-coding and starts citing.
   Includes the 11px split, which is the judgement call of the epic.
4. **The reading register and the figures.** 12/13/14 onto `--text-dense`/`--text-body`;
   15–30 onto the figure and title rungs. Retire `--text-3xl` if nothing wants it.
5. **Space.** Sub-8px rungs and the gutters. Delete `Empty`'s `inset` prop and its 9 call
   sites — the component stops taking a magic number because there is finally a token.
6. **The guard and the document.** `no-raw-type.test.ts` in the shape of `no-raw-colour.test.ts`:
   no raw `font-size`, `letter-spacing`, `line-height` or `font-weight` in a component style
   block, and no raw px in a spacing declaration, with a named exemption list that costs a
   sentence of justification to add. DESIGN.md §5 gains a type ladder beside the surface
   ladder, and the "13–14px base" line is replaced by something true.

Each of 3, 4 and 5 ends in a browser sweep across both themes, because every one of them
changes pixels on screens the tests cannot see.

## Decisions

Settled 2026-09-10, before the sweep, since each one was cheap to change at three commits
and expensive at six hundred sites.

1. **Units — rem.** The px would read better in the file, but the app has never had a zoom or
   responsive audit (§10), and removing the one mechanism that currently makes it scale while
   that is true is betting the wrong way.
2. **The space scale bends once.** 1 / 2 / 4 / 6 / 8 rather than strict doubling. 6px is 36
   declarations of genuinely common gap; including it caps the sweep's worst move at 1px where
   1/2/4/8 would have shifted about eighty gaps by 2px. This went against the first
   recommendation and the numbers were on the other side.
3. **The guard covers type and space, with exemptions.** Three entries, each carrying its
   reason. What is deliberately not on the list: "this value is too small to matter", which is
   an argument for deleting a declaration rather than keeping it.
4. **`base.css` sets no root font-size.** The rem basis belongs to the reader. The old
   `var(--text-base)` looked deliberate right up until the rung was renamed for its job and
   the line began claiming the app's basis was the size of money in a row.

## Outcome

All six stories shipped across two pull requests — the ladders in
[#235](https://github.com/lesterhan/have-fish/pull/235), the sweep and the guard after it.

**Two rungs the census got wrong**, both found by reading rules rather than counting them.
11px is the control register, not drift between two rungs, and 16px is `MoneyDisplay`. The
A/B that settled 11px is worth keeping: forcing every 11px element on the accounts page down
to 10 flattens the tabs and buttons into the column heads above them, and the text floats
inside button padding that did not shrink with it. A control that reads as a label is V3
stated in type.

**`Empty`'s prop was not deleted.** The plan said delete it and its nine call sites, on the
grounds that a component taking a magic number as a prop is a missing scale seen from outside.
Half right: three genuinely different insets exist, so the capability was needed and only the
*vocabulary* was wrong. It now takes `gutter | wide | none` — the caller names a rung. The
same argument as the type rename, one level up.

**The six `calc()` expressions were not exemptions.** Every one turned out to be a rung plus a
rung once rungs existed below 8px, so the spacing half of the guard needs no exemption list at
all. All three exemptions are tracking, and all three are marks drawn out of glyphs rather
than text set at a tracking.

**What it hands on.** The type ladder has nine rungs with four of them one pixel apart. Each
earns its place today, but that is a ladder someone can still pick the wrong rung from, and no
guard can catch *which* rung — only that a token was used. The other open thread is `%`, `em`
and `ch`, which the guard deliberately ignores as relationships rather than measurements; that
is a real hole if someone starts spelling sizes in `em` to get past it.

## Open questions

1. ~~**Is the type rename worth it?**~~ Merged in #235, which settles it — reversing now costs
   more than it saves.  Original argument: It touches 303 correct declarations to change nothing
   visible about them. The case for: `--text-xs` naming the most-used size is the specific
   thing that pushes people to raw pixels, and role names are what made the colour ladder
   stick. The case against: it is the largest mechanical diff in the epic and it improves no
   pixel. I think yes, but it is the one call I would not make alone.
2. ~~**11px.**~~ Answered before any of it was applied: it is the control register, it stays
   as its own rung, and the ladder is nine. What is still open one rung up is whether **10 and
   11** are two voices or one — the browser decides that, not the census.
3. ~~**rem or px.**~~ rem, see Decisions.
   Original argument: Keeping rem preserves browser font scaling, at the cost of rungs like
   `0.5625rem` for 9px. Switching to px would read better in the file and would suit an
   instrument panel with fixed density — but the app has never had a responsive or zoom audit
   (§10 standing debt), so removing the one mechanism that currently makes it scale seems like
   the wrong direction to bet. Proposal keeps rem.
4. ~~**Does the guard cover spacing?**~~ Both, with exemptions — and the spacing half needed
   none. Original argument: Raw px in `padding`/`gap` is 470 sites; the guard is what
   stops it coming back. But there are legitimate raw px values in spacing — a 1px border
   compensation, a hairline overlap. Either the exemption list gets long or the guard covers
   type only and space is held by convention. Leaning toward covering both and letting the
   exemption list be honest about it.
