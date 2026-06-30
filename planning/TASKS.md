# Backlog Tasks

Small, self-contained tasks that don't belong to an epic, grouped by area and tagged
with a rough priority.

**Priority legend:**

- **P0** — correctness / bugs. The data must be trustworthy; do these first.
- **P1** — quick wins, low risk, high ratio of value to effort.
- **P2** — medium features, real work but bounded.
- **P3** — epic-shaped. Needs a design discussion and a `planning/epics/` file before code.

Items marked **⚠️ epic** should graduate to `planning/epics/` when picked up.

---

# Import

## ✅ [P0] Rules mining appears broken — FIXED

**Root cause (two compounding bugs in `rules.ts` mining):**
1. Candidate filter required exactly 2 postings, excluding every Fish Pie (3–6
   postings) and multi-currency conversion (4–5 postings) transaction. A new
   multi-currency user's data was almost entirely excluded → no suggestions.
2. Threshold required >2 (i.e. 3+) exact-duplicate descriptions. Bank descriptions
   carry store numbers / refs / dates, so exact strings rarely repeat 3× on a first
   import.

**Fix:** select transactions with exactly one expense posting (admits Fish Pie +
multi-currency); normalize descriptions (`cleanDescription`, strips trailing store
numbers / dates / ref codes) before grouping so near-duplicates accumulate and the
stored stem generalizes via import-time substring matching; lower threshold to >=2.
Regression tests added in `rules.test.ts` (Fish Pie, multi-currency, normalization
grouping, 2-match floor).

---

## ✅ [P1] CSV import — support non-comma delimiters — DONE (PR #111, commit `57ce889`)

Shipped: backend `detectDelimiter()` (quote-aware, picks among `,` `;` `\t` `|`) and
`parseCsv` takes an explicit delimiter (auto-detect by default). Import preview retries
the remaining delimiters on a no-match so a parser built with a manual override still
matches. Frontend `lib/import/delimiter.ts` (detection + quote-aware line split); the
Add Parser wizard auto-detects, shows an override dropdown, and a live preview of the
split columns before mapping. No schema change — the column fingerprint carries the
delimiter. Tests cover all four delimiters incl. quoted fields + import match.

---

## [P1 → P2] Safer importing — don't lose categorization progress

**Context:** Importing a big CSV means manually categorizing many rows. All that work
lives only in the page's in-memory state. An accidental refresh, navigation, or tab
close wipes the whole session — you start over. Anxiety-inducing on large files.

**Task:** Make import progress durable so a refresh/close can't lose categorization
work. Two stages:

- **✅ P1 quick win — DONE.** `beforeunload` guard on the import page: a `$effect`
  registers a `beforeunload` listener whenever a preview is loaded (the in-progress
  categorization stage), warning before a refresh / tab close. A successful import
  leaves via client-side `goto`, which never fires `beforeunload`, so it only triggers
  on a real unload mid-session.
- **P2 full:** persist draft import state (localStorage / IndexedDB, or a backend
  draft) keyed to the file, and offer to resume on reload. Optionally incremental save —
  commit categorized rows as you go.

**Open questions (for the P2 stage):**
- Draft location — client-only (simplest, lost on device switch) or a server-side
  import-session record (survives anywhere, more work)?
- Dedup on resume so re-importing the same file doesn't double-create.

---

## [P2] Send an already-imported transaction to Fish Pie

**Context:** During CSV import a transaction can be marked for Fish Pie (shared
expense). If it wasn't marked at import time, there's currently no way to send it to
Fish Pie afterward — you'd have to re-import or manually recreate the expense.

**Task:** Add an action on an existing transaction to "send to Fish Pie" after the
fact. From the transaction list / detail (web, and ideally Companion), pick the Fish
Pie group + split and create the corresponding shared expense, linking it back to the
source transaction so it isn't double-counted.

**Open questions to pin down before building:**
- What links a transaction to its Fish Pie expense today (import path), and reuse that
  same link so the manual send behaves identically.
- Avoid double-count: confirm whether the existing import flow nets the personal
  transaction against the Fish Pie posting, and mirror it.
- Should this be reversible (un-send / unlink)?

---

# Accounts

## [P2] Rework `AccountPathInput` UX (web)

**Context:** `AccountPathInput` is fine for a keyboard-heavy power user, but the design
is clunky/painful to look at and not friendly for slower interaction. Works, but rough.

**Task:** Iterate on a better web interface for picking/entering an account path.
Explore designs — not a fixed spec yet. Candidate directions:

- Segment-by-segment picker (choose `expenses` → `food` → leaf) with create-new at each
  level.
- Keep fast keyboard autocomplete but improve the visual affordance and selected-state
  display.
- Possibly borrow from the Companion `AccountSelect` (root-type chips + fuzzy search +
  inline create) which tested well on mobile.

Design exploration first with Lester, then implement. Web only. May feed the account-reorg
epic's picker.

---

## ⚠️ [P3] Account reorganization — rename, merge, split, move (epic)

**Context:** A dedicated interface to reorganize expense categorization. Accounts are
hierarchical paths (`expenses:food:cafe`); today there's no way to rename or restructure
them, and existing transactions stay on the old path.

**Phase 1 — rename / re-path (the simple slice):**
- Rename a path (`expenses:food:cafe` → `expenses:food:coffeeshop`); re-point every
  transaction on it (and children).
- Renaming a parent segment (`expenses:food` → `expenses:dining`) cascades to all
  descendants.

**Phase 2 — full reorg:**
- **Merge:** fold `expenses:health:medical` + `expenses:health:pharmacy` into one.
  Renaming onto an existing path must merge, not collide — warn.
- **Split:** break `expenses:food:coffeeshop` into `expenses:food:coffee` +
  `expenses:food:bakery`, then **pick which transactions go where** (per-row
  reassignment, possibly rule-assisted).
- General move/reparent across the tree.

**Open questions to pin down before building:**
- Are accounts a first-class table, or derived from distinct paths used by transactions?
  Determines rename = UPDATE on an accounts row vs. bulk re-path of transaction rows.
  Check `schema.ts`.
- Keep Fish Pie clearing accounts (`assets:receivable:<slug>`) and budgets consistent
  when a referenced account is renamed/moved.
- Bulk-reassignment UX for split; undo/preview before applying.
- Design discussion first → promote to `planning/epics/`. Phase 1 could ship as a
  smaller standalone step ahead of the full epic.

---

# Transaction display

## ⚠️ [P3] Single-transaction view — clearer multi-posting display + smart edit (epic)

**Context:** Complex transactions have many postings and look messy in the current
modal. Real example — spending 50 EUR via Wise while out of EUR, so Wise also did an
on-the-fly conversion:
- `assets:wise:cad` → `assets:wise:eur` (80 CAD → 50 EUR)
- `equity:conversion` posting (the rate balancing)
- `expenses:banking:fee` posting (Wise fee)
- `expenses:food:cafe` (the actual spend)

One transaction, 4–5 postings, hard to read. Three problems:

**1. Visual explanation.** The detailed view should *narrate* what happened — group the
mechanical postings (conversion, fee, account transfer) apart from the meaningful spend,
show the cross-currency flow legibly, surface the rate. Not a raw posting dump.

**2. Smart edit.** To recategorize the spend (`expenses:food:cafe` →
`expenses:food:restaurants`) the user shouldn't hand-edit raw postings. The view should
identify the editable/meaningful fields and let you change them directly, leaving the
balancing/mechanical postings intact.

**3. Reuse.** Once improved, use this transaction view in more places — e.g. the
spending page right-side panel — instead of one-off modal markup.

**Open questions:**
- How to classify "meaningful spend" vs "mechanical" postings (conversion/fee/transfer)
  — heuristic by account root (`equity:`, `expenses:banking:fee`, asset↔asset) or an
  explicit posting role/flag?
- Keep balance integrity on edit — recategorize must not unbalance the entry.
- Cross-currency display: show both legs + effective rate.
- Design discussion first; promote to `planning/epics/`.

---

## [P0 + P1] Spending page UX improvements

**Context:** Spending page is hard to navigate and has a correctness bug.

**✅ [P0] Amounts don't add up — FIXED (PR #112, commits `2c445df` + `8d7e718`).**
Root cause: `pageTotal` (and `SpendingTxnRow.mainPosting`) used `.find()`, grabbing the
*first* expense posting — for a cross-currency spend that was the tiny USD fee
(`expenses:banking:fee`, 0.05 USD), missing the real spend (360 CZK). Fixed `pageTotal`
to filter/reduce over all expense postings (matching backend `spending-converted`);
`mainPosting` now picks the largest-abs expense posting so the row shows the real spend;
currency filter chips + page total scoped to expense postings only (so a USD→CZK spend
no longer shows under the USD filter via its asset leg). Regression test added in
`reports.test.ts`.

**[P1] Nav not loud enough.** The important navigation (filters/period/account
selectors) is visually too quiet relative to its importance — page is hard to move
around. Raise its visual weight/hierarchy.

**[Blocked → P3] Right-panel reuse.** Once the [Single-transaction view] epic lands,
swap the right-panel into that shared component instead of one-off markup.

---

# UI polish

## ✅ [P1] Theming — fix dark-mode accent/white-text contrast — DONE

**Root cause:** dark-mode `--color-accent` / `--color-accent-hi` are deliberately bright
pastels (Nord), and the accent system already ships the correct paired text token
`--color-accent-fg` (flipped to near-black in dark by `accent.ts`). But a cluster of
components ignored it — hardcoding `color: #ffffff`, or using the wrong static token
`--color-accent-text` (near-white in *both* themes) — so selected/active surfaces showed
white-on-pastel. Measured WCAG: every accent failed (1.50–2.49, below the 3.0 floor).

**Fix:** retired `--color-accent-text` entirely (it was a near-duplicate of
`--color-accent-fg` that only the latter kept theme-correct) and pointed every
text-on-accent surface at `--color-accent-fg`: the four autocomplete dropdowns
(`CurrencyInput`, `AccountPathInput`, `GroupSelect`, `DateRangeSelector` active rows),
the `AccountPicker` selected-row treatment, `Checkbox` checkmark, `TransactionRow` radio
dot, and the spending Σ badge. After: every accent passes AA (7.69–14.04). Light mode
unchanged (`--color-accent-fg` is `#ffffff` there — identical to the old hardcode).
`AccentPicker`'s swatch check left as-is: it always renders the *light* swatch variants
regardless of theme and is shadow-protected, so it's not the dark-mode token bug.

**Note (out of scope, pre-existing):** light-mode **ochre** active-fill is white on
`#b89028` ≈ 2.98 — a hair under AA-large, unchanged by this work. Flag for a future
light-mode pass if it bothers in practice.

---

## ✅ [P1] Extract tooltip icon into a shared component — DONE

Shipped: `frontend/src/lib/components/ui/TooltipIcon.svelte` (accepts a `label` prop,
renders the styled `?` button + `use:tooltip` internally). Adopted across the app
(EditParserPanel, the parser wizards, import page, settings); no inline
`class="tooltip-icon"` pattern remains.

---

## ✅ [P1] Currency input component — DONE

Shipped: `frontend/src/lib/components/ui/CurrencyInput.svelte` — autocomplete over
supported currencies, `CurrencyPill` display state, text-field edit state mirroring
`AccountPathInput`. Replaced every plain `<TextInput>` currency field (import, settings,
reconcile, quick-entry, posting editor, add-transaction, Fish Pie settle, wizards); no
`<TextInput>`-based currency field remains.

---

# Categorization metadata

## ⚠️ [P3] Transaction notes / tags (separate from name) (epic)

**Context:** A transaction's name comes from the CSV (`GREY HOUND`) — terse, fixed,
sometimes cryptic. Lester wants a separate user field for added context: a free-text
**note** (e.g. "bus fare to Ottawa for camping trip") and/or **tags** for grouping
across accounts (e.g. `#camping-trip`).

**Task (epic-shaped):**
- Add a note field (free text) and tags (multi-value) to transactions, distinct from
  the imported name.
- Editable both **during import** (sequence after the import quick-wins) and **later**
  when sorting/reviewing.
- Tags should be filterable/groupable — e.g. total spend for a trip across many
  categories.

**Open questions:**
- Notes (1:1 free text) vs tags (many:many, needs a tag table + join) — likely both,
  but confirm scope. Tags are the bigger build.
- Surface in web tx list/detail first; Companion later.
- Carry into hledger export? hledger has tags/comments — map onto that for portability.
- Schema change required → promote to `planning/epics/`.

---

# Companion

## [P2] Filter settled expenses out of the history list (web + companion)

**Do after the Companion epics are done.** Noticed while testing: the Fish Pie
history/expense list grows unbounded — every expense ever logged is dumped into one
list on both the web UI and the Companion History tab. Over time you have to scroll
past a wall of old, already-settled expenses to reach anything current or to find the
settlements.

**Task:**

- **Both platforms:** add a filter toggle on the expense list — a hide/show **settled**
  expenses button — so the default view shows only expenses still outstanding.
- **Companion History tab:** mirror the web UI's two-section layout — an `EXPENSES`
  section (with the new hide/show-settled filter) and a separate `SETTLEMENTS` section
  (including proposed/pending settlements). Today everything is one list, so you must
  scroll to the bottom to see any settlement. The two-section History layout is already
  specced in `planning/epics/mobile-companion-history-settings.md` (Story 1) — the new
  piece here is the settled-expense filter; fold it in if that epic hasn't shipped yet.

**Open question — what does "settled" mean per-expense?** Fish Pie has no per-expense
settled flag. Settlement nets *balances* between members, not individual expenses
(money is fungible — a settlement doesn't map to specific rows). So "hide settled
expenses" needs a definition before building. Candidates:
- Expenses dated before the most recent settlement that cleared the balance between the
  involved members (approximate, by date).
- A derived "fully covered by later settlements" notion (hard — requires attributing
  settlement amounts back to expenses, which the model deliberately avoids).
- Simplest: a per-expense `settledAt` set when a settlement covering its members lands,
  or a manual "archive expense" action.

Pin down the semantics with Lester before implementing. If it turns out to need a
schema change + backend work, promote this from a task to a small epic.

---

## [P2] Companion: full group settings page + relocate app settings

**Do after the Companion epics are done.** Noticed while testing: the gear icon sits
top-right next to the **group name**, so it reads as *group* settings — but the
Companion Settings screen (`mobile-companion-history-settings.md` Story 2) is
deliberately read-only and app-ish. Mismatch between what the placement implies and
what the screen does.

**This reverses a prior scope decision.** That epic's Story 2 and its *Out of scope*
section explicitly keep category/account/weight editing off mobile ("web-managed by
design, to keep the phone fast"). Lester now wants editable group settings on mobile
after the current planned work. Update that epic's notes (or supersede them) when this
is picked up.

**Task:**

- **Group settings page (under the gear icon):** mirror the web UI's group settings —
  editable, not just a display. At minimum: set up **categories** (and their posting
  accounts), rename group, member weights/split, invites, delete. The existing
  `GroupSettingsPanel` + `lib/api.ts` methods already cover most of this on mobile;
  this is largely re-surfacing them behind the gear rather than greenfield. Confirm the
  web group-settings surface to mirror exactly.
- **App settings — move elsewhere.** Separate app-level settings (server URL, account,
  sign out, theme, etc.) out of the group context. Placement TBD — candidate is a
  bottom-nav entry. **Decide with Lester** before building.

Decide the split between group vs app settings and the app-settings location with
Lester at pickup time.

---

# Done

## Companion: refined account selector / creator — ✅ Done (PR #97, commit `76e609c`)

Shipped: `mobile/components/AccountSelect.tsx` replaced the old flat `AccountPicker.tsx`
everywhere (expense entry, settle, confirm sheets). Root-type scope chips
(assets / liabilities / expenses / income / equity), fuzzy autocomplete over the account
path, and an inline create row when no account matches. All search/create logic lives in
the RN-free `lib/account-search.ts` helper (`createSuggestion`).

## Companion: better server-address entry on login — ✅ Done (PR #93)

Shipped: scheme toggle + host + prefilled-port (`8887`) inputs and a remembered-server
quick-pick (deselectable; tapping a recent hides the form). Servers persist in
SecureStore (`getServers`/`addServer`/`removeServer`) via the RN-free
`lib/server-url.ts` helper. The account-settings Server card shares the same
`ServerAddressFields` component and records to the remembered list on "Update URL". The
login screen was also restyled onto the Companion gloss design.
