# Epic: Accounts Page — consolidation and curation

**Design canvas:** [Quieter Sidebar](https://claude.ai/code/artifact/b210a4c1-e2e5-4ed6-bd9f-56e669ee1400)
— page 1 is the built design, page 2 keeps the sidebar direction sketches.

Goal: Give accounts one home. Move them out of the sidebar into a real page, make the sidebar
a launcher instead of an index, and delete the two other surfaces that list accounts today.

## Background — three surfaces, none of which agree

Accounts are listed in three places right now, and each shows a different population:

| surface | shows | supports |
|---|---|---|
| `Sidebar.svelte` | 21 balance-bearing accounts, grouped assets / liabilities / equity | click through, hide |
| `/settings` → "Accounts · N" panel | **every** path, flat — accounts *and* all 118 expense categories | posting count, delete, add by raw path |
| `/accounts/manage` | the tree, expenses-first | in-place rename with prefix cascade, transaction preview |

That is why nothing feels like it is in one place. It also produces the presenting complaint:
the sidebar is unreadable at 21 accounts.

Three distinct causes, worth separating because the fixes are different:

1. **The sidebar renders leaves, not the tree.** `assets:wise:*` is six sibling account rows,
   not one account with six balances. `accountTree.ts` already builds the nested structure;
   the sidebar does not use it.
2. **Balances live inside the navigation.** `.account-balances` is a flex column, so a
   multi-currency account is two or three rows tall. 15 visible accounts render as 19 lines
   and 19 `CurrencyPill`s. That pill rainbow is most of what reads as "busy".
3. **Nothing is ranked.** `Visa 2101` (daily) and `CAGE` (no balance, never opened) get
   identical weight.

## Design decisions

**Accounts leave the sidebar entirely.** The sidebar becomes seven nav items plus what you
pinned. This is the boldest of the four directions explored (canvas page 2) and the one that
addresses cause 2 at the root: a sidebar is for going places, and 21 accounts are data.

**Ctrl+K replaces the index.** `accountScorer.ts` already ranks segment-aware — `wis` ranks
`assets:wise:*` correctly today — and `accountIndex.ts` already memoizes the lookups. The
palette is mostly re-siting working code out of `AccountPicker`. Ctrl+K, not Cmd+K: the user
is on Linux (accept both; label the Linux binding).

**Because Ctrl+K answers "where is X", the page must not be a directory.** If its only job is
listing accounts, it has no job left. Everything on it has to answer something the sidebar
could not: what do I actually have, can I trust this number, what is unfinished.

**Two tabs, one route.** `expenses:*` are rows in `accounts` too, so the rename and delete
mechanics are identical — but the columns are not (categories have no balances). One route
with a `TabStrip`: **Accounts** (21 balance-bearing rows, money columns) and **Categories**
(the expenses/income tree, entry counts). Settled in discussion over a separate page and over
one unified tree, which 100+ expense leaves would swamp.

**Institution grouping is derived, not modelled.** "Wise", "Wealthsimple" is path segment 2
(`liabilities:wealthsimple:visa` → Wealthsimple). No schema change; it is a convention that
happens to hold for this data. The grouping control offers Type / Currency / Flat for when it
does not.

**Every account row must appear somewhere.** The Settings list was the safety net: it showed
literally every path, unfiltered. The tabs filter by configured root, so anything outside them
lands in an **Unfiled** bucket rather than vanishing. This is not optional — losing a row is
worse than the clutter we started with.

**The page does not convert until asked.** Every figure at rest is the preferred-currency
balance and nothing else: exact, complete on its own terms, and true without a single rate
lookup. A figure that omits money says so — `+ 2 currencies held` — without pretending to
price it, and the Cash card is labelled **Available** rather than Cash, because "Cash" invites
the question "so where is my USD?" that an unconverted figure is not answering.

One **Convert to CAD** control fetches rates for the currencies actually on the page and folds
them in: the position row totals everything, an `≈ CAD` column appears in the table, and the
notes switch from what is missing to how much the rates covered. Settled in discussion over
converting on load: this page is mostly navigation, and hitting the FX endpoint on every visit
to it buys a number nobody asked for. If no rate resolves at all the page stays unconverted
rather than switching into a column of dashes; a partial failure converts and says what it
missed, per figure.

Because the note has to survive a trip through four countries, it never lists currencies —
`CAD only`, `2 of 3 currencies`, `+ 2 currencies held`. The full list lives in the tooltip.

**Currency is operational, not ambient.** The need is to spend and convert between accounts
while travelling, and afterwards to see what is left over so it can be consolidated or left
alone. That is a deliberate question asked occasionally, not a number worth carrying at the
top of the page every visit. So there is **no standing exposure chart**: the Group control's
**Currency** option answers it on demand, grouping accounts by currency with a total per
group and every row already actionable underneath. No new component, and it does not nag.

**Buckets derive from root paths, not from a flag.** The position row splits net position
into Cash / Investments / Owed / Owing, and every one of those is already readable from the
path: `equity:*` is Investments, `assets:receivable:*` is Owed, `liabilities:*` is Owing, the
rest of `assets:*` is Cash. No `illiquidAccountIds`, no new state — see the Deferred section
for why the flag is not being built here.

**Pinning has to cost one gesture.** The pinned sidebar only survives if curation is cheap.
Six Wise accounts pinned one at a time is six trips, so multi-select with group-header
select-all is load-bearing, not a nicety.

## What this page does *not* take over

- **Catch Up** keeps the guided, statement-by-statement flow. This page shows the same state
  as a column and links into it; it does not re-implement the coach.
- **The account page** keeps the coverage strip, quick entry and the settings modal. This is
  the overview, not a replacement.
- **Import** keeps its flow; the page only pre-targets it.

The test for anything proposed here: *could you answer it without opening an account?* If not,
it belongs on the account page.

## What stays in Settings

User-level, not per-account, so it does not move:

- **Root paths** — `defaultAssetsRootPath` / `Liabilities` / `Expenses` / `Equity`. They
  define the taxonomy the page renders, so they cannot live inside it.
- **Default offset / conversion / adjustments accounts** — pointers *at* accounts. Surfaced on
  the page as role chips, but still set here.
- Preferred currency, accent colour, profile, danger zone.

---

## Stories

### 1. Backend — last activity per account

`backend/src/routes/accounts.ts`.

- Extend `GET /api/accounts/posting-counts` to return `{ accountId, count, lastActivity }`,
  where `lastActivity` is `MAX(transactions.date)` over non-deleted postings. Additive — the
  existing callers (settings panel, manage page) ignore the new field and are deleted in
  story 7 anyway.
- One grouped query alongside the existing count, same `userId` scoping and same
  `deletedAt IS NULL` filters on both `postings` and `accounts`.
- `lastActivity` is `null` for an account with no postings; the UI renders "never".
- Tests in `accounts.test.ts`: count and date together, soft-deleted postings excluded,
  cross-user isolation, null for an empty account.

### 2. Route shell + Accounts tab (read-only)

`frontend/src/routes/(authed)/accounts/+page.svelte`, new.

- `TabStrip` with **Accounts** and **Categories**; tab in the URL (`?tab=`) so it is linkable
  and so story 7's redirect can target the Categories tab.
- Sidebar gains an **Accounts** nav item (the rest of the sidebar rewrite is story 4).
- Accounts tab lists every account under the assets / liabilities / equity roots, grouped by
  institution, collapsible per group with a rolled-up `≈ preferred currency` total.
- Columns: Account · Type · Balance (native) · ≈ CAD · Last activity · Flags.
- Last activity carries a staleness sub-label derived from `lastActivity` alone —
  `stale 74d` past a threshold, nothing otherwise.
- Controls: search (reuse `accountScorer`), Group (Institution / Type / **Currency** / Flat),
  Show (Active / All / Hidden). The Currency option is the answer to "what am I still holding
  after the trip" — it is the only currency-overview surface the page ships.
- **Position row** above the table: Available / Investments / Owed / Owing, each derived from
  the configured roots as described in the design decisions. No net-worth total.
- **Unfiled**: any account outside every configured root gets its own group at the bottom.
- Balances come from the existing `GET /api/accounts/balances`.
- **Conversion is a request, not a default** — see below.

### 3. Curation — pins, hide, bulk, role guards

- New `pinnedAccountIds?: string[]` in `UserPreferences` (`frontend/src/lib/api.ts`), same
  pattern as `hiddenAccountIds` — `preferences` is free-form JSONB, no migration.
- Row actions: pin / unpin, hide / unhide.
- Multi-select: per-row checkbox plus a group-header checkbox that takes every child. Bulk bar
  appears while a selection exists: Pin all, Hide all, Set currency, Import. Escape clears.
- **Role chips + guard.** An account referenced by `userSettings.defaultOffsetAccountId`,
  `defaultConversionAccountId` or `defaultAdjustmentsAccountId` shows an `OFFSET` /
  `CONVERSION` / `ADJUSTMENTS` chip, and cannot be deleted or hidden until it is re-pointed.
  This closes a live bug: the Settings panel today will delete your default offset account and
  leave the pointer dangling, breaking every import that leans on it.
- `assets:receivable:*` stays system-managed and is excluded from destructive actions, as in
  `/accounts/manage` today.

### 4. Sidebar rewrite

`frontend/src/lib/components/Sidebar.svelte`.

- Delete the account groups, the balance rendering, the `CurrencyPill` stack, the per-group
  add-account affordance and the `accounts` / `settings` props that fed them.
- Keep: the nav (now with Accounts), the collapse toggle, theme, the settings link.
- Add a **Pinned** section from `pinnedAccountIds` and a **Recent** section derived from
  `lastActivity` — recently *transacted*, not recently *visited*, which needs no new state.
  Show the top 3 by default, excluding anything already pinned; the count is a constant to
  tune in use, not a setting.
- Add the Ctrl+K jump palette: `accountIndex` + `accountScorer`, Enter opens, Escape closes.
  Accept Cmd+K too; label it `Ctrl K`.
- Drop the sidebar's balance fetch and the `sidebarRefresh` bump that follows account
  creation, unless the pinned rows still need it.

### 5. Categories tab

- Tree over `expenses:*` and `income:*`, plus Unfiled. Port the tree builder and the in-place
  segment rename from `/accounts/manage` — same `POST /api/accounts/rename`, same cascade
  confirm ("this renames N child accounts"), same collision pre-check.
- Columns: Category · Entries · Last used · Flags. No spend or share-of-spend columns and no
  period control — see Deferred.
- **Quick-add by raw path**, replacing the Settings form: type a full path, parents are
  created implicitly as they are today.
- **Guarded delete**: `DELETE /api/accounts/:id` already exists; offer it only on rows with
  zero postings, and surface the count of those rows as a filter chip.
- **Flat view**, preserving the one thing the Settings list did that a tree does not.

### 6. Row expansion + attention

- Clicking a row expands it in place rather than navigating: last 5 entries, what is
  unfinished, and the actions. Opening the full account page stays available but stops being
  mandatory. This absorbs `/accounts/manage`'s right-hand transaction preview.
- Attention comes from the existing bulk `GET /api/accounts/action-required-summary`, whose
  results are currently rendered as a 6px dot in the sidebar and nothing else.
- An attention filter chip in the toolbar ("5 need attention") scopes the table.
- On the Categories tab the same drawer serves `expenses:uncategorized`: what is sitting in
  it, and a link into the transactions list filtered to those entries.

### 7. Delete the old surfaces

- Remove the `/accounts/manage` route; redirect it to `/accounts?tab=categories` so existing
  links and muscle memory survive.
- Remove the Settings "Accounts · N" panel entirely — the list, `handleCreateAccount`,
  `handleDeleteAccount`, the posting-count fetch, and the Manage button. Reflow what is left
  of the settings grid; the right column goes.
- Sweep for now-unused imports (`scrollShadow`, `Icon`, the account fetches) in
  `settings/+page.svelte`.

---

## Deferred — decided 2026-08-29, recorded so we do not rediscover them

Each of these was proposed during design and deliberately left out. None is a blocker; all
are severable from the stories above.

### Dropped outright

**Spend and share-of-spend columns on Categories.** Spend totalled over an arbitrary window is
not actionable — "food, 11,204" over 12 months tells you nothing you would act on from a
management page — and the moment you want it scoped properly you are on the Spending page,
which already does it well. Dropping it also removes the only period control on the page.

**"Likely a typo" detection on Unfiled rows.** Fuzzy-matching a stray path against the
configured roots needs a confidence threshold and is confusing when it misfires. The
**Unfiled bucket itself stays** — that is the safety net, not a tweak. A clearly-labelled
group already gets you to the fix.

### Deferred, with the trigger that would revive them

**Standing currency-exposure chart.** Cut in favour of Group by Currency (story 2). The need
is operational — spend and convert while travelling — and retrospective — see the leftovers
and consolidate. Neither wants a persistent chart at the top of the page reminding you that
you hold some CZK. *Revive if:* grouping proves too coarse to answer "what am I holding"
quickly, or a genuine cross-currency reporting need appears.

**Coverage state in the trust column** (`covered` / `2 gaps`). `GET /api/catch-up` returns
per-account coverage but **only for tracked accounts**, so untracked rows would show a blank
that reads as a bug. Plain staleness from `lastActivity` covers the real need. *Revive if:*
a bulk coverage endpoint appears, or tracking becomes universal.

**Dust flag.** Needs a threshold, and thresholds in multi-currency are their own argument.
Sorting by `≈ CAD` ascending gets the same list with no new concept.

**Rule replay in the uncategorized drawer** ("2 of these match a rule → apply"). Real new
logic: replaying `importRules` against already-imported postings. That belongs to an
import-rules epic. The drawer without it still shows what is sitting in uncategorized and
links to the filtered transactions.

**Net-worth hero number.** `/dashboard` is mothballed, so this would be the only place it
lives — but the four position buckets sum to it, and stating it adds a headline nobody asked
for. *Consequence to accept:* after this epic, net worth is not displayed anywhere. *Revive
if:* the dashboard comes back, or the buckets prove to need a total.

### Illiquid flags and the equity rethink — **decided: build neither now**

`Locked` was originally a fourth bucket backed by `illiquidAccountIds` from the
[Illiquid Account Flags](illiquid-account-flags.md) epic. It is not being pulled in, for two
reasons:

1. **The flag has no consumer.** Its whole justification was excluding locked assets from
   cash-position and runway maths — and runway is deprioritized with the dashboard
   mothballed. Building it now is building for a calculation that is shelved.
2. **It is probably the wrong shape.** The stated future direction for TFSA / FHSA /
   Direct Index is to see **gains and losses** — cost basis against market value. That is a
   richer model than a boolean "exclude from cash", and a binary flag shipped now would more
   likely be in the way than a head start.

What replaces it costs nothing: the **Investments bucket derives from the `equity:` root**
(design decisions above), so the page distinguishes locked-up money from spendable money today
with no new state at all.

**Recorded for the future:** when equity accounts are rethought — cost basis, market value,
gains and losses — the Accounts page is a natural host, and the Investments bucket is the
thing that grows those columns. That work should decide the fate of `illiquidAccountIds`
rather than inheriting it. Tracked in `planning/TASKS.md` under Accounts.

### Confirmed in scope

**Ctrl+K scoped to accounts** (story 4). A full command palette — jump to pages, run actions,
add a transaction — is the obvious next step and the obvious way to blow this epic open. The
palette shell makes adding verbs later cheap; ship account-jumping only.

**"Recent" derived, not tracked** (story 4). Recently transacted rather than recently visited.
Close enough, free, and tunable by changing one constant.

## Open questions

- **Institution grouping** relies on path segment 2. It holds for the current data. If it
  drifts, the Group control's Type / Currency / Flat options are the escape hatch — no schema
  change is proposed either way.
- **Story 7 leaves Settings visibly emptier.** Expected, but worth a look before merging;
  the page may want reflowing rather than just having a column removed.
