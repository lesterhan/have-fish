# Epic: Catch-Up Coach

**Goal:** Make returning to the app after weeks away a bounded, legible task instead of a
daunting pile. Tell the user which accounts need data, which date ranges are missing, and
how much work each one is — then get out of the way until asked.

---

## Background

The failure mode this fixes: the app goes unused for a month or two, transactions accumulate
unentered, and the longer it is left the more daunting re-entry becomes. It is made worse by
partial state — some transactions *have* been entered (split expenses logged from the phone
while travelling) sitting inside months that are otherwise untouched. Looking at the
transactions list, there is no way to tell "this month is done" from "this month has three
things in it and forty missing."

### The fact the app cannot currently represent

There is no way to say **"this account's ledger is complete through date D."** Everything in
this epic follows from adding it.

Today the only available signal is the last transaction date on an account, which cannot
distinguish a quiet account from a neglected one, and — the part that matters most here —
can never say *done*. Without a representable "done" there is no honest finish line and no
reward worth showing.

Two adjacent features already throw this fact away:

- **Reconciliation** posts an adjustment and forgets. The knowledge that the ledger matched
  the bank on Jul 31 — the strongest possible evidence of completeness — is discarded.
- **Import** knows the date range of every file it ingests (the Confirm step displays it) and
  discards that too. There is no import batch record anywhere in the schema.

### Coverage is asserted, not inferred

A new `account_coverage` table records intervals the user (or an import, or a reconcile)
asserts are complete. Append-only with soft delete, so every assertion keeps its provenance
and can be undone.

**Intervals, not a single high-water date.** Imports arrive out of order — August gets done
before July does. A single watermark would either lie (claiming July complete) or refuse to
advance past it. Intervals let the app say *"you have Jan–Feb and Aug; Mar–Jul is missing"*,
which is both true and more useful.

### The horizon — why "caught up" is not "covered through today"

Banks differ in what they will hand over. Wise exports any range on demand; a credit card
only produces a statement when the cycle closes. A card that closes on the 25th cannot
possibly be covered through the 20th, and nagging about it is nagging about the bank.

So each account has a **horizon**: the most recent date for which data is *obtainable*.

| Export mode | Horizon |
|-------------|---------|
| `range` — any date range on demand (Wise, most chequing) | today |
| `cycle` — fixed statement periods (credit cards) | end of the most recently *released* statement, i.e. the latest cycle close `C` where `C + releaseLag <= today` |

**Caught up means coverage reaches the horizon, not today.** The span between horizon and
today renders as *not yet available* — visually distinct from a gap, and never counted as
work. A monthly card spends most of the month reading **Current — next statement Mar 25**
rather than permanently guilty.

Cycle config is **inferred and correctable**: repeated monthly coverage intervals ending near
the 25th infer `cycleDay: 25`. The guess is shown on the account and can be overridden.

### Dormant accounts, and the ones that come back

`assets:wise:eur` sits dormant until a European holiday, then matters intensely for three
weeks. `assets:wise:cny` fires quarterly. Neither should be nagged about while quiet, and
neither may be silently dropped when it wakes up.

Because coverage is an explicit stored fact, "behind" is never inferred — which demotes the
cadence model to a **ranking signal only**. It orders the queue and estimates work; it never
decides whether a gap exists. A mis-modelled dormant account therefore cannot hide real
missing data, only sort it lower. That is the whole reason the heuristic is safe to keep
simple.

Two mechanics carry the dormant case:

1. **Covering an empty period is one click.** "Nothing happened here — mark covered through
   `<horizon>`" writes an interval with source `empty`. A quiet account costs one click a
   month, not an import.
2. **Revival is detected, not declared.** Any transaction dated inside an uncovered window —
   including splits entered from the phone mid-holiday — promotes the account out of dormant
   and up the queue. This is exactly the mixed-state case: the phone-entered transactions are
   *evidence the account is live*, not evidence the range is complete.

### What the app honestly cannot know

It cannot know which dates inside an unimported window have transactions. Only the bank
knows. Any UI claiming otherwise would be fabricating.

What it can show truthfully, per account, is a **coverage strip** with four day states:

- **Covered** — asserted complete.
- **Has transactions, not covered** — the phone-entered splits. Ticks inside an open gap.
- **Uncovered** — unknown. This is the honest answer to "which dates do I need."
- **Beyond horizon** — not yet obtainable. Greyed, not a gap.

Plus an estimate for each gap: uncovered days × the account's historical transactions/day →
*"RBC Visa: 47 days uncovered, ~62 transactions expected."*

### Not nagging — the rules

Being behind is **not broken data**, and must not borrow the vocabulary of one that is.
"Action Required" owns red dots and warning badges for genuinely broken records (missing FX
rates, uncategorized postings). The coach never uses them.

- Never red. Never a sidebar dot. Never a notification or email.
- The dashboard shows an **account count, not days behind**. "4 accounts to catch up" is
  actionable; "63 days behind" is only guilt.
- Snooze silences the dashboard tile without losing any state.
- **The coach only ever asks about the leading edge** — the window from an account's latest
  coverage forward. Older holes are recorded in the data but never surfaced. A 2019 gap
  sitting in a queue forever is the definition of nagging.
- The queue is ordered **smallest gap first**. Momentum beats triage.

### Bootstrap — the first-run problem

On the day this ships, no account has a single coverage row, so every account reads
maximally behind. For an anti-nag feature that is the worst possible first impression.

There is no import history to reconstruct coverage from, so the coach asks once instead:
**Set your starting line.** For each account it proposes a `manual` interval ending at that
account's last transaction date, with a one-action "accept all" — the user has been using the
app, so the existing ledger is presumed real. Until the starting line is set, the coach shows
only this step and the dashboard tile stays silent.

### Rewards — deliberately deferred

This epic ships a progress bar and simple graphics only. A real rewards system is wanted
later but is explicitly not designed here; see *Future* at the bottom so the idea is not lost.

---

## Data model

```
account_coverage
  id           uuid pk
  userId       text  → user.id (cascade)
  accountId    uuid  → accounts.id
  fromDate     date        -- inclusive
  throughDate  date        -- inclusive
  source       text        -- 'import' | 'reconcile' | 'manual' | 'empty'
  note         text        -- nullable, e.g. the statement filename
  createdAt    timestamp
  deletedAt    timestamp   -- soft delete = undo an assertion
```

Indexed on `(userId, accountId, fromDate)`. Intervals may overlap on write; they are merged
at read time. `deletedAt IS NULL` filtering per house convention.

**Per-account config** lives in `userSettings.preferences` under a `catchUp` key —
`{ [accountId]: { exportMode?, cycleDay?, releaseLag?, tracked? } }` — following the same
precedent as `hiddenAccountIds`. Only *overrides* are stored; the effective config is the
backend's inference merged with any override. No migration on `accounts`.

**Tracked accounts** are all non-deleted asset and liability accounts, minus any flagged
illiquid, hidden, or explicitly dismissed via `tracked: false`. Expense and income accounts
are derived from postings and never participate.

---

## Stories

### 1. Schema + coverage CRUD

Backend / `db/schema.ts`, new `routes/coverage.ts`.

- Add `account_coverage` per the model above; `db:generate`, then both `db:migrate` and
  `db:migrate:test`.
- `POST /api/coverage` — `{ accountId, fromDate, throughDate, source, note? }`. Validates
  `fromDate <= throughDate`, account ownership, and that source is one of the four.
- `DELETE /api/coverage/:id` — soft delete.
- `GET /api/accounts/:id/coverage` — merged intervals for one account, newest first.
- An interval-merge helper (sort by start, coalesce overlapping and adjacent spans) shared by
  every reader. Adjacent means `next.from <= prev.through + 1 day` — Jun 1–30 and Jul 1–31
  must merge into one span, not read as a gap.

Tests: merge helper against overlapping, adjacent, nested, and disjoint inputs; ownership is
enforced on write and delete; a soft-deleted interval disappears from the merged result.

### 2. Horizon and cycle inference

Backend / new `services/coverage-horizon.ts`.

- `inferCycle(accountId)` — examine existing coverage intervals and transaction dates for a
  monthly rhythm; return `{ exportMode, cycleDay, releaseLag }` or null when there is not
  enough signal. Needs at least three intervals before it will guess.
- `effectiveConfig(accountId)` — inference merged with the user override from
  `preferences.catchUp`. Override always wins.
- `horizon(config, today)` — `today` for `range`; for `cycle`, the latest cycle close `C`
  where `C + releaseLag <= today`. Clamp `cycleDay` to the month's length so day 31 resolves
  to Feb 28/29.
- `PATCH /api/coverage/config/:accountId` — write an override.

Tests: horizon on the 24th, 25th and 26th for a `cycleDay: 25, releaseLag: 0` account;
`releaseLag` pushing the horizon back a full cycle; day-31 clamping in February on a leap and
non-leap year; override beating inference; inference declining to guess on thin data.

### 3. `GET /api/catch-up` — the assembled payload

Backend / new `routes/catch-up.ts`.

Returns, for each tracked account:

```
{ accountId, path, name,
  state,                  // 'current' | 'behind' | 'unset'
  horizon, horizonReason,  // 'today' | 'statement', + nextHorizonDate when cycle
  coveredThrough,          // end of the contiguous span at the leading edge
  gap: { from, through, days } | null,   // leading edge only
  expectedTxns,            // days × historical txns/day, integer estimate
  txnDatesInGap: [ ... ],  // dates with existing transactions inside the gap
  dormant,                 // ranking signal only
  config }
```

Plus a summary: counts by state, and progress `{ current, tracked }`.

- `state: 'unset'` means no coverage rows at all — drives the bootstrap step.
- The gap is the leading edge only: from `coveredThrough + 1 day` to `horizon`. Historical
  holes are deliberately not returned.
- `dormant` when trailing-window transaction volume is ~zero. Ranking only.
- Ordered smallest gap first, dormant accounts last.

Tests: an account covered exactly to a cycle horizon reads `current`, not `behind`; an
account covered to today with a horizon behind today reads `current`; out-of-order intervals
(Aug covered, Jul missing) produce a leading-edge gap starting after the Jul hole, and the
Jul hole is absent from the payload; `txnDatesInGap` picks up exactly the transactions inside
the open window; an account with no coverage reads `unset`; expense and income accounts are
absent; illiquid, hidden and `tracked: false` accounts are absent.

### 4. Bootstrap — set your starting line

Frontend / `/catch-up` first-run state.

- When any tracked account is `unset`, the page shows only this step.
- One row per unset account: the account, its last transaction date, and an editable
  "complete through" date defaulting to that date. Accounts with no transactions at all
  default to "nothing to assert" and are skipped.
- **Accept all** writes one `manual` interval per account in a single request.
- Individual rows can be adjusted or skipped; a skipped account stays `unset` and is asked
  about again next visit, without any badge.
- The dashboard tile (story 9) renders nothing at all while any account is `unset`.

Tests: accept-all writes one interval per account ending on the proposed date; a skipped
account remains `unset`; an account with zero transactions is not offered.

### 5. Coverage strip component

Frontend / `lib/components/catch-up/CoverageStrip.svelte`.

A horizontal band of day cells spanning a given window (default: 90 days back to today).

- **Covered** — filled, using the raised control treatment.
- **Uncovered** — `--shadow-inset` trough.
- **Beyond horizon** — muted fill with a "not yet available" tooltip. Visually *not* a gap.
- **Transaction ticks** — small marks on days with transactions, so phone-entered splits are
  visible sitting inside an open gap.
- Month boundaries labelled; hovering a cell names the date and its state.

Mounted on the single account page beneath the existing account header, and reused by the hub.

Tests: component renders the four states from a fixture; the horizon boundary lands on the
correct cell; ticks appear only on transaction dates.

### 6. `/catch-up` hub page

Frontend / new route + `lib/components/catch-up/`.

- A `Card` per tracked account with a `.section-header`: account name, state chip, gap
  summary (*"47 days · ~62 transactions"*), and a `CoverageStrip`.
- Current accounts collapse to a single quiet line; `cycle` accounts append
  *"next statement Mar 25."*
- Actions per row: **Import** (story 7), **Nothing happened here** (writes an `empty`
  interval through the horizon), **Mark complete through…** (a date picker writing `manual`),
  and **Don't track this** (sets `tracked: false`).
- Aggregate progress bar at the top: accounts current / accounts tracked, in the Aqua gloss
  treatment. Simple graphics only — no rewards system.
- Dormant accounts render below a quiet divider, collapsed by default.
- Fully caught up: the page collapses to a single calm confirmation panel.

Tests: `check` passes; states render distinctly; the empty-interval action posts the right
range; dismissal removes the row.

### 7. Focus queue and import handoff

Frontend / `/catch-up` + existing import flow.

- **Start catching up** enters focus mode: one account at a time from the ordered queue, with
  position shown (*"2 of 5"*).
- Import dispatches to `/import?account=<id>&from=<date>&to=<date>&return=catch-up`. The
  import session store reads the prefill and preselects the source account.
- The **Confirm** step gains a *"This file covers …"* control. Default: the range the coach
  asked for when arriving from it, otherwise the file's row min/max. The distinction matters —
  a statement covering Jul 1–31 whose first transaction is Jul 3 still covers Jul 1–2.
- On commit, write an `import` coverage interval for that range, then return to the coach with
  the row refreshed rather than landing on `/transactions`.
- Back-navigation and abandoning an import must leave the queue intact and write no coverage.

Tests: prefill params reach the session store; commit writes exactly one interval matching the
confirmed range; an abandoned import writes none; the return path resumes at the right queue
position.

### 8. Reconcile writes coverage

Frontend / `ReconcileModal.svelte` + backend.

Reconciling to date D means the ledger agrees with the bank at D by construction — the
adjustment posting makes it so. On a successful reconcile, write a `reconcile` interval
through D regardless of whether the difference was zero.

- The interval starts at the end of the previous contiguous coverage span, or the account's
  earliest transaction date when there is none.
- The modal states plainly what it is asserting: *"Marks this account complete through
  Jul 31."*

Tests: a zero-difference reconcile writes an interval; a non-zero one does too; the interval
starts at the previous coverage edge; a failed reconcile writes nothing.

### 9. Dashboard tile and snooze

Frontend / `dashboard/+page.svelte`.

- One neutral line, no colour alarm: **"4 accounts to catch up"** linking to `/catch-up`.
  Account count, never days behind.
- Fully caught up: **"Ledger current"** with a small Aqua-gloss check.
- Any account `unset`: renders nothing.
- **Snooze** — a quiet control hiding the tile for 7 days, stored in
  `preferences.catchUp.snoozedUntil`. Snoozing changes no coverage state.
- No sidebar dot. No badge. Nothing shared with Action Required.

Tests: the tile reflects the summary counts; snooze hides it and expires; the unset state
renders nothing.

---

## Sequencing

1 → 2 → 3 build the backend bottom-up. 8 is small and independent once 1 lands, so it can go
early and start accruing real coverage data. 5 before 6 (the hub consumes the strip), 4 before
6 is visible in earnest, then 7, then 9 last so the dashboard only ever reflects a finished
model.

---

## Out of scope

- **Mobile.** CSV import is a desktop job. A read-only glance and a mark-empty action are
  plausible follow-ups; noted, not built.
- **Historical backfill.** Old holes are recorded but never surfaced. A separate never-badged
  backfill view is the natural follow-up if the leading edge proves insufficient.
- **Import batch records.** This epic stores coverage intervals, not a full import history.

## Future — rewards

Deferred deliberately, captured so it is not lost. The app is 有鱼, and *catch up* ↔ *catch
fish* is sitting right there: a pond on the hub gaining a fish per account brought current,
full when the ledger is. Streaks and stats were explicitly rejected — the motivation should be
visual, not numerical. Nothing here ships in this epic.
