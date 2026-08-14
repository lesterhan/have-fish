# Epic: Import Flow — Multi-Step Redesign

Goal: Turn the import preview from one long scrolling table into a four-step flow — **File → Sort → Review → Confirm** — so that a month of daily transactions is handled as a handful of merchant decisions plus a short chronological pass, instead of 200 identical ones.

## Background

Today the whole of preview + edit + commit lives in a single `{#each preview.transactions}` in `ImportPreviewPanel.svelte`. For a week of transactions that's fine. For a month it fails in three ways:

1. **No sense of place.** The section bar shows only ready/skipped counts. Nothing says "23 of 187 reviewed", so it's easy to lose your position and impossible to know how much is left.
2. **No notion of "done".** The data already distinguishes a row the user decided on from one sitting at the uncategorized default — that signal is computed and thrown away. There is no filter, so handled and unhandled rows look identical.
3. **Repeat merchants are one-at-a-time.** `cleanDescription()` (`backend/src/routes/rules.ts:58`) already collapses `LOBLAWS #042 06-22` and `LOBLAWS #117` into one merchant stem. It only runs *after* the import, in `POST /api/rules/mine`. So the user categorizes the same merchant seven times, imports, then mines a rule that would have saved those seven clicks.

### The unlocking change

Return the merchant stem on the preview response. One backend field (`merchantKey`, from the existing `cleanDescription`) makes three things fall out of the same data: merchant grouping, in-preview rule harvesting, and per-row status.

### Two constraints that shape the design

**Chronology is a memory aid.** When importing a month-old statement the user reconstructs the day to decide whether a row is coffee or groceries, or whether it should be split. Regrouping the review table by merchant destroys that. So:

> **Never reorder the review table. Remove things from it instead.**

Merchant thinking and day thinking are different modes, so they get different steps. Sort clusters by merchant (order irrelevant — "LOBLAWS is always groceries" has no date attached). Review stays strictly chronological and gains *emptiness*: whatever Sort resolved drops out of the default filter, leaving only rows that need a memory call, with the neighbouring rows of that same day right there for context.

**No invisible mistakes.** Anything auto-applied — by a saved rule or by a Sort cluster — stays visibly marked and auditable. Clusters already covered by an existing rule are shown greyed with a chip naming the matching pattern, never hidden. Review keeps the existing "pre-filled by import rule" indicator and adds an **Auto** filter so every auto-applied row can be audited in one pass.

---

## Scope note — absorbed epic

This epic folds in [`import-rules-fish-pie.md`](import-rules-fish-pie.md) (stories 1–4). The Sort step is materially better when a rule can mean "always split BILLA into the household group", so the split-rule schema is a prerequisite rather than a follow-up. That epic's story 5 (mine split rules from history) stays out of scope and is listed under Stretch below.

Recommend archiving `import-rules-fish-pie.md` and pointing ROADMAP at this epic once story 3 here lands.

---

## The four steps

Stepper chrome reuses the existing `.section-bar` pattern from the import page — four segments showing done ✓ / current / upcoming, earlier segments clickable to go back.

### 1 · File

What the page has today: drop zone, defaults disclosure, parsers panel. Plus **Import as liabilities**, moved here from the preview panel — it is a property of the source account and it flips the sign of every amount downstream, so it belongs before the user starts reading amounts.

### 2 · Sort

Skipped automatically when no merchant appears more than once.

One row per merchant cluster, sorted by count descending:

```
LOBLAWS          ×7   3–27 Jun   −412.80   [expenses:groceries    ▾]   ⊙ remember
BILLA            ×4   5–22 Jun   −88.10    [🥧 Household · Groceries]  ⊙ remember
STARBUCKS        ×3   2–19 Jun   −31.50    matched by rule «starbucks»        ← greyed
```

- **Expandable** to its member rows in date order, so a row can be peeled out of the bulk assign ("that BILLA was a gift, not groceries") before it lands.
- **Target** is either an expense account or a Fish Pie split (group + optional category), using the same controls as a review row.
- **remember** writes an active import rule from the cluster's stem and target. Defaults **on** for clusters of 3+, **off** for pairs.
- **Already-matched clusters** render greyed with a chip naming the rule pattern that matched. Not hidden — a wrong rule must be visible. Clicking one expands it and allows an override.
- Footer: *Apply and continue* / *Skip*.

### 3 · Review

Strictly chronological, sticky day headers (`Sat 14 Jun`). Default filter **Needs review**; chips for All / Needs review / Auto / Done / Skipped. Progress in the section bar: `18 of 42 reviewed`. `n` jumps to the next unreviewed row.

Row controls are what exists today (account picker, Fish Pie split, skip), plus a **save as rule** affordance for a one-off the user now wants remembered. The `AccountPicker` mounts only on interaction — resolved rows render as a compact label until clicked, which both calms the list and removes hundreds of heavy component instances.

### 4 · Confirm

Summary: *N to import · M duplicates skipped · R rules created · 2 accounts to create*. The missing-accounts banner moves here — it is a hard blocker, so it belongs at the gate rather than nagging through Review. Commit → confetti → `/transactions`.

---

## Session state

Multi-step navigation means the state has to outlive a single component. The `beforeunload` guard at `import/+page.svelte:349` is already an admission of this.

Persist to `localStorage`, keyed by a hash of the CSV text, as plain serializable JSON:

```ts
type ImportSession = {
  version: 1
  fileHash: string          // sha-256 of the CSV text
  fileName: string
  step: 'file' | 'sort' | 'review' | 'confirm'
  defaultCurrency: string
  fromAccountId: string
  importAsLiabilities: boolean
  preview: ImportPreviewResult
  rowStates: RowState[]
  clusterStates: ClusterState[]
  savedAt: string           // ISO; sessions older than 30 days are dropped on load
}
```

Shaped so that moving it to a backend `import_sessions` table later is a transport change, not a rewrite. That move (survives a device switch — start on desktop, finish on mobile) is deliberately **out of scope** and belongs in its own epic.

### Row provenance

`RowState` gains a provenance field so status is recorded rather than inferred:

```ts
source: 'none' | 'rule' | 'cluster' | 'user'
```

Status derivation, in order:

| Status | Condition |
|---|---|
| Skipped | `skipped` (duplicate or manual) |
| Done | `source === 'user'` |
| Auto | `source === 'rule' \| 'cluster'` |
| Needs review | `source === 'none'` |

### Back-navigation safety

Going Review → Sort → Review must not stomp hand edits. **A cluster assignment only writes rows whose `source !== 'user'`.** A cluster whose members include user-edited rows offers an explicit *override all 7* which writes them anyway.

---

## Stories

### 1. Backend — merchant key and rule provenance on preview

- Move `cleanDescription` out of `routes/rules.ts` into `backend/src/import/merchant.ts`; re-export from `rules.ts` so the mining route is untouched. One source of truth for normalization, shared by mining and preview.
- `POST /api/import/preview`: stamp `merchantKey` (= `cleanDescription(description)`) on every row that has a description, regular and transfer alike.
- When an active rule matches, also stamp `matchedRulePattern` alongside the existing `suggestedOffsetAccountId` / `suggestedExpenseAccountId`, so the UI can name the rule that fired rather than just showing a generic indicator.
- Add both to `ImportPreviewResult`'s row types in `frontend/src/lib/api.ts`.

Tests: preview a CSV with three descriptions that normalize to one stem, assert one shared `merchantKey`; seed an active rule, assert `matchedRulePattern` on the matching row and absent on the others.

### 2. Rule schema — optional Fish Pie split target

*(absorbed from `import-rules-fish-pie.md` story 1)*

- `importRules.accountId` drops NOT NULL; add nullable `groupId` (→ `expense_groups`) and `categoryId` (→ `group_categories`). Generate migration, apply to dev **and** test.
- Invariant: exactly one of `accountId` / `groupId` set. `categoryId` only meaningful with `groupId`. Enforced in `POST /api/rules` and `PATCH /api/rules/:id`; both-set or neither-set → 400. Verify group/category ownership.
- `GET /api/rules`: `leftJoin` accounts + groups + categories, returning `accountPath`/`accountName` or `groupName`/`categoryName` so the list renders either kind.
- A split rule stores no expense account — the expense leg derives from the category at posting-build time, same as a manual split. One source of truth for category → expense account.

Tests: create both rule kinds, fetch both, assert the right display fields; assert the invariant rejects both-set and neither-set.

### 3. Import preview — apply split rules

*(absorbed from `import-rules-fish-pie.md` story 2)*

- Backend: when the matched rule is a split rule, stamp `suggestedGroupId` / `suggestedCategoryId` instead of `suggestedOffsetAccountId`. First match still wins.
- Frontend: `rowStates` init reads `suggestedGroupId` → `groupId` / `categoryId`, `source: 'rule'`. The row renders pre-split through the existing Fish Pie pills branch.
- Pills get the same "pre-filled by import rule" indicator the offset cell has, so an auto-applied split is distinguishable from a manual one.

Tests: seed a split rule, preview a matching CSV, assert the suggested group/category; assert a pre-split row commits as a group split.

### 4. Frontend — session store and stepper shell

Pure refactor plus chrome. No change to how rows are edited.

- Extract the page's `$state` into a serializable `ImportSession` store; add `source` to `RowState`.
- `localStorage` persistence keyed by file hash; restore on mount with a "resume this import?" prompt naming the file and its saved step. Drop sessions older than 30 days. Clear on successful commit.
- Four-segment stepper in the section bar; earlier steps clickable. Replace the `beforeunload` guard, which is now redundant.
- Move **Import as liabilities** to the File step.
- Review renders today's existing table unchanged — this story is the shell only.

Tests: round-trip a session through serialize/restore; assert commit clears it and a stale session is dropped.

### 5. Sort step

- Cluster rows by `merchantKey`; show clusters of 2+, sorted by count descending. Auto-skip the step when there are none.
- Cluster row: stem, count, date range, summed amount, target control (expense account or Fish Pie split), `remember` toggle — default on at 3+, off at 2.
- Expand to member rows in date order; a member can be excluded from the bulk assign.
- Already-matched clusters render greyed with a `matched by rule «pattern»` chip and expand for override.
- *Apply and continue* writes targets to member rows with `source: 'cluster'`, skipping `source === 'user'` rows; `override all N` includes them. `remember` clusters create active rules via `POST /api/rules`.

Tests: clustering groups near-duplicate descriptions and leaves singletons out; apply writes only untouched rows; override writes all; remember creates a rule of the right kind.

### 6. Review step

- Strictly chronological with sticky day headers. **Never regrouped.**
- Filter chips All / Needs review / Auto / Done / Skipped with live counts; default **Needs review**. Progress indicator in the section bar.
- `n` jumps to the next unreviewed row.
- Resolved rows render as a compact label; the `AccountPicker` mounts on click/focus.
- Any direct edit sets `source: 'user'`.
- Per-row **save as rule** *(absorbed from `import-rules-fish-pie.md` story 3)*: creates an active rule from the row's `merchantKey` plus whatever the user assigned — expense account or Fish Pie split — and applies it to remaining rows in this preview whose `source` is `'none'`.

Tests: filter counts match derived statuses; editing a row flips it to Done and out of the Needs-review filter; save-as-rule creates the right rule kind and back-fills only untouched matching rows.

### 7. Confirm step

- Summary counts: to import, duplicates skipped, rules created, accounts to be created.
- Missing-accounts banner and its create/create-all actions move here and gate the commit.
- Commit reuses today's `handleConfirm` payload construction unchanged; on success clear the session, toast, confetti, navigate.

Tests: the gate blocks commit while paths are missing; the payload is byte-identical to today's for an equivalent set of row states.

### 8. Manage Rules UI — split rules

*(absorbed from `import-rules-fish-pie.md` story 4)*

`/import/rules` renders and edits both rule kinds: a target column showing either an account path or `Group · Category`, and an editor that switches between the two target types.

---

## Sequencing

1 → 2 → 3 establishes the data. 4 is the shell and is the natural PR boundary — everything before it is invisible to the user, everything after depends on the store. 5, 6, 7 are the three steps and ship in that order. 8 closes the loop on rule management.

## Stretch / out of scope

- **Mine split rules from history** — extend `POST /api/rules/mine` to suggest split rules from transactions with a Fish Pie leg. (`import-rules-fish-pie.md` story 5.)
- **Backend `import_sessions`** — server-side session state so an import survives a device switch. Own epic; the state shape above is designed to make it a transport change.
- **Keyboard triage mode** — a single-row focused mode with type-to-assign. Revisit once the step split has had real use.
