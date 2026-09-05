# Epic: Trust Signals

**Depends on:** the coverage model (`backend/src/coverage/catch-up.ts`), already shipped.
**Ships before:** the inbox count in Honest Chrome story 2 — see "Ordering" below.

Goal: stop the app presenting stale figures with the confidence of fresh ones. Every
aggregate says what date it is complete through, and no derived comparison is drawn across a
period the app has not fully recorded.

## UX brief

- **Question this screen answers:** "can I believe this number?" — asked of every aggregate
  in the app.
- **Inbox role:** it supplies the honest tenant of the status bar, and its predicate
  (`behind && !dormant`) is the same one the eventual inbox count uses.
- **Primary action + interaction count:** no new action. The measure is that no figure can
  be read as more current than it is, at zero added interactions.
- **Case or work:** the status bar readout is case; the rollup and spending marks are work.
- **Existing patterns reused:** the coverage model, `MoneyDisplay`, the coverage strip's
  hatch idiom (`--color-coverage-hatch`) for "not known".
- **Patterns being stretched or replaced:** none — this is additive to surfaces that already
  exist.
- **What gets deleted:** the unqualified month-over-month and prior-3-month comparisons on
  `/spending` whenever either side is incomplete. Nothing else.

## Background

`DESIGN.md` §1: "Trust is earned by being checkable. Every displayed figure must be
traceable to the rows that produced it... never show a total the UI can't explain." The app
honours that at row level and abandons it at aggregate level.

The accounts page tells the truth per row — `bank:chequing` carries a red "stale 74d" right
under Last Activity. It then sums those rows into **AVAILABLE 20,119.73 CAD** in the largest
type on the screen with no qualification at all. The app knows every input is stale and
discards that knowledge exactly where the user is most likely to act on it.

The figure is not wrong, which is what makes it slippery: it is arithmetically correct and
semantically stale. It answers "the sum of what you have recorded" beneath a label that
promises "what you have." Nobody reads it as the former.

`/spending` is worse. It renders a month total, a month-over-month delta, and a comparison
against the prior three months, with no coverage awareness anywhere in the file. A stale
balance is merely old. A stale spending comparison actively lies: it draws a fall in August
that reads as "I spent less" when it means "I recorded less." A low total is ambiguous;
"down 60% vs the prior 3 months" is an assertion, and under partial coverage it is a
fabricated one. It is also precisely the kind of statement someone makes a decision on.

## Design decisions

**A rollup is only as current as its stalest live contributor.** *Live* is load-bearing: a
dormant account 200 days behind does not make a total wrong, because it has nothing to
contribute. The completeness date is `min(coveredThrough)` across contributing accounts that
are `behind && !dormant` — the same predicate the inbox count will use. One definition
feeding both is the sign it is the right one.

**The as-of is derived from the same rows as the sum.** Each tile mins the dates of exactly
the rows it is already adding up. No separate endpoint, no second query, and therefore no
way for the date and the figure to disagree — which is the failure that would make this
feature worse than nothing.

**Count the gap; never price it.** `expectedTxns` is legitimate: a fact about coverage,
derived from the account's own recorded rate over covered days. Converting it to a dollar
estimate is a guess about money displayed next to a real balance, and when it is wrong it
destroys more trust than the staleness did. "~40 transactions unrecorded" ships. "~$2,400
unrecorded" never does, in any surface, in any form.

**Suppress incomplete comparisons rather than qualifying them.** A qualified comparison is
still read as a fact — the caveat is smaller than the number and loses. Where either side of
a comparison is not fully covered, the comparison is not drawn, and its space says why.
An absence with a reason is honest; a footnoted lie is not.

**Incomplete is a third state, not a low value.** In the monthly series an under-covered
month is hatched, not short. `--color-coverage-hatch` already carries exactly this meaning
in the coverage strip ("beyond the horizon"), and reusing it means the app has one visual
idiom for "not known" instead of two.

**No greying out of stale figures.** The tempting move is to mute stale numbers. When
everything is stale everything mutes, the page reads as broken, and it fights §5's hierarchy
rules. The date does the work; the figure keeps its weight.

## Ordering

This ships before the inbox count (Honest Chrome story 2), for two reasons. The trust
readout is the honest tenant of the status bar — "Complete through Jun 21" degrades
gracefully to "Complete through today" when caught up, where a bare queue count has the
ambiguous-zero problem discussed at length in `planning/exploration/`. And the count depends
on the `behind && !dormant` predicate this epic establishes and tests.

Honest Chrome story 2 is amended to render the trust readout; the inbox count becomes a
later decision on top of it.

## Stories

### 1. Coverage on the accounts payload

`backend/src/routes/accounts.ts`, `backend/src/coverage/`, `frontend/src/lib/api.ts`.

Add `coveredThrough`, `state` and `dormant` to the rows the accounts page already fetches,
reusing the catch-up assembly rather than duplicating its logic. The catch-up payload itself
is too heavy for this (90-day strips per account); this is the same derivation, projected.

**Built as `GET /api/coverage/accounts` rather than as fields on `/accounts/balances`.** That
endpoint already has two mutually-exclusive selection modes (`types` vs `include=unfiled`) and
did not want a third axis, and story 4 puts this in the status bar on every page, where
dragging a whole balances payload along to date one sentence is the wrong trade. The accounts
page merges it exactly as it already merges `/posting-counts`.

Export a shared helper for the completeness date over a set of rows so stories 2 and 4 cannot
drift apart: given rows, return `min(coveredThrough)` over `behind && !dormant`, or `null`
when every contributor is current.

**Tests:** the projection matches catch-up's own state for the same fixtures; the helper
returns null when all contributors are current, ignores dormant and unset rows, and picks the
oldest live contributor; an account with no coverage at all does not silently read as
current.

### 2. Rollup tiles carry their as-of

`frontend/src/routes/(authed)/accounts/+page.svelte`.

Each of the four tiles (Available, Investments, Owed to you, You owe) renders its own
completeness date beneath the figure, computed from the rows that tile sums. They will
differ, and that is the point — Owed to you may be current while Available is two months
behind.

Copy: "complete through Jun 21" when behind; "complete through today" when current. Not
"stale", not a warning colour, not an icon — a statement in `--color-text-muted` at
`--text-xs`. The figure keeps its weight and its colour.

**Tests:** a tile with all-current contributors shows today; one stale contributor sets the
date; a dormant stale contributor does not; tiles compute independently.

### 3. Spending is coverage-aware

`frontend/src/routes/(authed)/spending/+page.svelte`, `SpendingBreakdown.svelte`.

Classify the selected month against the coverage of the accounts contributing to it:
**complete** (every contributor covers the whole month), **partial**, or **uncovered**.

This needed a second endpoint, `GET /api/coverage/months`, because story 1's projection cannot
answer it: a leading edge says nothing about a hole behind it, and a month sitting in that hole
is unrecorded however recent the edge is. It also carries `assertedAccounts` — with no coverage
asserted anywhere, every month classifies as uncovered, and a user who has never bootstrapped
must not be told none of their spending is recorded.

- Complete: unchanged.
- Partial: the total is a floor, not a value. Mark it as such and name what is missing —
  which accounts, and through what date.
- Uncovered: no total. Say the month has not been recorded and offer the route to record it.

The month-over-month delta and the prior-3-month comparison are **not drawn** unless both
sides are complete. Their space says why: "August is only partly recorded — no comparison
yet."

~~In the monthly series, under-covered months are hatched rather than short.~~ **Dropped
during the build: there is no monthly series.** `/spending` fetches seven months of totals
(`fetchMonthlySpend(7)`) purely to compute the two deltas and never draws them. The hatch
rule stayed in `DESIGN.md` §4 for whenever a trend is drawn; nothing was built to satisfy
it here.

This is the story that most wants a screenshot in the PR (§7): the difference between "you
spent less" and "we don't know" is the entire point, and it is not reviewable from a diff.

**Tests:** the three classifications from coverage fixtures; comparisons suppressed when
either side is incomplete and shown when both are complete; a partial month's total is
labelled as a floor; the hatch appears on exactly the under-covered months.

### 4. The status bar trust readout

`frontend/src/routes/+layout.svelte`.

Replace the static "Ready" with the completeness date across all live accounts, using the
story-1 helper. "Complete through Jun 21" / "Complete through today". Clicking navigates to
`/catch-up`. A live toast still wins the space and the readout returns when it clears.

Invalidate after an import commits, a reconciliation, or a transaction is added.

This supersedes Honest Chrome story 2 — amend that epic to point here rather than
implementing a count.

**Tests:** the two display states plus loading; the click target; invalidation fires from
each mutation path.

### 5. Write the rules back into DESIGN.md

Fold the aggregate rules into §1 and §4, add the checklist line, and strike the §10 entries
this epic closes.

## Out of scope

- The inbox count itself — a later decision, on top of this.
- Pricing the gap, in any form. See Design decisions; this is a permanent exclusion, not a
  deferral.
- Per-row staleness on the accounts page, which already exists and is already honest.
- Mobile (`mobile/`) — same principle, its own surfaces, its own epic.
