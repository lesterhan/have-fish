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
  `stale 74d` past a threshold, nothing otherwise. (Coverage state is tweak T5.)
- Controls: search (reuse `accountScorer`), Group (Institution / Type / Currency / Flat),
  Show (Active / All / Hidden).
- **Unfiled**: any account outside every configured root gets its own group at the bottom.
- Balances come from the existing `GET /api/accounts/balances`; conversion uses the existing
  fx-rates route and `preferredCurrency`.

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
  `lastActivity` (no new state — tweak T10).
- Add the Ctrl+K jump palette: `accountIndex` + `accountScorer`, Enter opens, Escape closes.
  Accept Cmd+K too; label it `Ctrl K`.
- Drop the sidebar's balance fetch and the `sidebarRefresh` bump that follows account
  creation, unless the pinned rows still need it.

### 5. Categories tab

- Tree over `expenses:*` and `income:*`, plus Unfiled. Port the tree builder and the in-place
  segment rename from `/accounts/manage` — same `POST /api/accounts/rename`, same cascade
  confirm ("this renames N child accounts"), same collision pre-check.
- Columns: Category · Entries · Last used · Flags. (Spend columns are tweak T1.)
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

## Tweaks — decide before story 1

Everything above is settled. Everything below I proposed and am not confident in; each is
severable, and the epic works without any of them.

### T1. Spend and share-of-spend columns on Categories — **recommend: drop**

Drawn on the canvas as `Spent` and a `Share of spend` bar, with a Period control.

Against: spend totalled over an arbitrary window is not actionable — "food, 11,204" over 12
months tells you nothing you would act on from a management page, and the moment you want it
scoped properly you are on the Spending page, which already does this well. It also drags in
the only period control on the page, for one column.

For: it makes the biggest categories obvious when you are deciding what to reorganize.

If dropped, the Categories tab is Entries + Last used, and the Period control goes with it.

### T2. "Likely a typo" detection on Unfiled rows — **recommend: drop the heuristic, keep the bucket**

The `FIX PATH` chip on the canvas guesses that `expense:groceries` meant `expenses:`.

The **Unfiled bucket itself is not a tweak** — without it, a mis-pathed account becomes
invisible once the Settings list is gone, which is a regression. But the guess is fuzzy
matching against root paths, needs a confidence threshold, and is wrong in a confusing way
when it misfires. Listing the row under a clearly-labelled Unfiled group already gets you to
the fix.

### T3. Currency exposure meter — **recommend: keep, as its own story**

The stacked bar in the position card. It is the strongest argument for the page existing —
six currencies and the app has never shown that in one picture, despite multi-currency being
principle 3 of the vision.

Cost: every balance converted to preferred currency, so it leans on the fx-rates route for
rates that may be missing or stale, and needs an honest answer for what to show when a rate is
unavailable. Colour is bound to the currency code permanently (never to size, so a rate move
never repaints the bar); the six hues are validated for colour-blind separation against the
dark surface.

If cut, the position card is four numbers and still worth having.

### T4. The four buckets — Liquid / Locked / Owed / Owing — **decide: sequence against illiquid flags**

`Locked` depends on `illiquidAccountIds`, which is the backlogged
[Illiquid Account Flags](illiquid-account-flags.md) epic. Options: pull that epic's stories 1–2
in here (it is small — a preferences key and a toggle), land it first, or ship three buckets
now and add Locked later. I lean on pulling it in: this page is where the flag pays off, and
its own epic's story 3 (dashboard filtering) can follow separately.

### T5. Coverage state in the trust column — **recommend: defer**

The canvas shows `covered` / `2 gaps` under the date. `GET /api/catch-up` already returns
per-account coverage, but **only for tracked accounts** — untracked ones would show nothing,
which reads as a bug rather than a distinction. Plain staleness from `lastActivity` (story 2)
covers the actual need: is this number old.

### T6. Dust flag — **recommend: defer**

`Wise GBP · 0.29 · DUST`. Needs a threshold, and thresholds in multi-currency are their own
argument. Sorting by `≈ CAD` ascending gets you the same list with no new concept.

### T7. "2 of these match a rule → apply" in the uncategorized drawer — **recommend: defer**

Real new logic: replay `importRules` against already-imported postings. That is an import-rules
epic, not this one. The drawer without it still shows what is sitting in uncategorized and
links to the filtered transactions.

### T8. Net worth hero number — **decide: overlap with Dashboard**

`/dashboard` is WIP and owns cash position and runway. Net worth on this page is arguably
duplication. I lean on keeping it here (this is the only page that sees every account) and
having the dashboard link across rather than recompute.

### T9. Ctrl+K scope — **recommend: accounts only**

A full command palette (jump to pages, run actions, add a transaction) is the obvious next
step and the obvious way to blow the epic open. Ship account-jumping; the palette shell makes
adding verbs later cheap.

### T10. "Recent" section in the sidebar — **recommend: derive, do not track**

Deriving from `lastActivity` means recently *transacted*, not recently *visited*, which is not
the same thing. Real visit tracking needs new state in preferences and a write on every
navigation. Derived is free and close enough; revisit if it feels wrong in use.

---

## Open questions

- **Institution grouping** relies on path segment 2. It holds for the current data. If it
  drifts, the Group control's Type / Currency / Flat options are the escape hatch — no schema
  change is proposed either way.
- **Story 7 leaves Settings visibly emptier.** Expected, but worth a look before merging;
  the page may want reflowing rather than just having a column removed.
