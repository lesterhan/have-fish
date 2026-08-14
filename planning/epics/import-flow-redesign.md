# Epic: Import Flow — Multi-Step Redesign

Goal: Turn the import preview from one long scrolling table into a five-step flow — **File → Accounts → Sort → Review → Confirm** — so that a month of daily transactions is handled as a handful of merchant decisions plus a short chronological pass, instead of 200 identical ones.

## Background

Today the whole of preview + edit + commit lives in a single `{#each preview.transactions}` in `ImportPreviewPanel.svelte`. For a week of transactions that's fine. For a month it fails in four ways:

1. **No sense of place.** The section bar shows only ready/skipped counts. Nothing says "23 of 187 reviewed", so it's easy to lose your position and impossible to know how much is left.
2. **No notion of "done".** The data already distinguishes a row the user decided on from one sitting at the uncategorized default — that signal is computed and thrown away. There is no filter, so handled and unhandled rows look identical.
3. **Repeat merchants are one-at-a-time.** `cleanDescription()` (`backend/src/routes/rules.ts:58`) already collapses `LOBLAWS #042 06-22` and `LOBLAWS #117` into one merchant stem. It only runs *after* the import, in `POST /api/rules/mine`. So the user categorizes the same merchant seven times, imports, then mines a rule that would have saved those seven clicks.
4. **Setup masquerades as an error.** A multi-currency CSV needs an account per currency. Today that surfaces as a warning banner above the table (`ImportPreviewPanel.svelte:122`) and, if ignored, as `"Please create all required accounts before importing"` at commit — the last possible moment. It is a setup task, not a failure.

### The unlocking change

Return the merchant stem on the preview response. One backend field (`merchantKey`, from the existing `cleanDescription`) makes three things fall out of the same data: merchant grouping, in-preview rule harvesting, and per-row status.

### Three constraints that shape the design

**Chronology is a memory aid.** When importing a month-old statement the user reconstructs the day to decide whether a row is coffee or groceries, or whether it should be split. Regrouping the review table by merchant destroys that. So:

> **Never reorder the review table. Remove things from it instead.**

Merchant thinking and day thinking are different modes, so they get different steps. Sort clusters by merchant (order irrelevant — "LOBLAWS is always groceries" has no date attached). Review stays strictly chronological and gains *emptiness*: whatever Sort resolved drops out of the default filter, leaving only rows that need a memory call, with the neighbouring rows of that same day right there for context.

**No invisible mistakes.** Anything auto-applied — by a saved rule or by a Sort cluster — stays visibly marked and auditable. Clusters already covered by an existing rule are shown greyed with a chip naming the matching pattern, never hidden. Review keeps the existing "pre-filled by import rule" indicator and adds an **Auto** filter so every auto-applied row can be audited in one pass.

**Mapping is data, not convention.** Today the currency → account link is re-derived from a naming convention every time it is needed: `accountIdForCurrency` (`import-helpers.ts:38`) rebuilds `assets:wise:eur` from the root path plus the lowercased currency code, and `handleConfirm` calls it four separate times. That was a simplification taken early and it is now wrong — it means the user cannot map a currency to an account that doesn't follow the pattern, and the app decides on their behalf where money lives. The mapping becomes explicit state the user owns:

> **The user maps currencies to accounts. The derived path is only the suggested default.**

This deletes `inferredPaths` / `missingPaths` and removes convention-based lookup from the commit path entirely — commit reads a record instead of rebuilding strings. It is roughly the same amount of code, better shaped.

---

## Scope note — absorbed epic

This epic folds in [`import-rules-fish-pie.md`](import-rules-fish-pie.md) (stories 1–4). The Sort step is materially better when a rule can mean "always split BILLA into the household group", so the split-rule schema is a prerequisite rather than a follow-up. That epic's story 5 (mine split rules from history) stays out of scope and is listed under Stretch below.

Recommend archiving `import-rules-fish-pie.md` and pointing ROADMAP at this epic once story 3 here lands.

---

## The five steps

Stepper chrome reuses the existing `.section-bar` pattern from the import page — segments showing done ✓ / current / upcoming, earlier segments clickable to go back.

### 1 · File

What the page has today: drop zone, defaults disclosure, parsers panel. Plus a post-parse summary line naming the parser, row count, date range, and unparsed count.

**Import as liabilities** moves here from the preview panel, and stops being a toggle. It is already inferred correctly from the account's path root in every real case (`+page.svelte:147-151`), and as a live switch it silently re-signs every amount from the middle of the review table. It becomes a **derived chip** in the File summary — `IMPORTED AS LIABILITIES`, with a tooltip explaining that CSV charges are stored negated because the account is a debt — with an override available but not presented as the primary control.

### 2 · Accounts

**Where does this money live.** One row per currency present in the CSV:

```
CAD   →  [assets:wise:cad          ▾]   existing
EUR   →  [assets:wise:eur          ▾]   ⊕ create
RMB   →  [assets:wise:rmb          ▾]   ⊕ create   ← editable; user may point at assets:wise:cny
```

- The derived path (`<root>:<currency>`) is pre-filled as the **suggestion**. The control is `AccountPicker`, which already does select-or-create, so "accept the suggestion" and "pick something else" are the same widget and there is no separate create-all button to reason about.
- **Gates the flow.** Rows cannot be mapped to accounts that don't exist, so deferring this only relocates the same blocker to commit time.
- **Auto-skipped** when every currency already resolves to an existing account — the common repeat-import case.
- This step subsumes the single-currency `fromAccountId` picker currently living in the preview table's header (`ImportPreviewPanel.svelte:95`). A single-currency import is just this step with one row. One control answers the question for both import kinds.
- Accounts created here get `defaultCurrency` set. Today `handleCreateMissingAccount` calls `createAccount({ path })` and nothing else, leaving `accounts.default_currency` null on every account this flow creates — despite this being the one place in the app where the currency is known with certainty, because the path was derived *from* it.

### 3 · Sort

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

### 4 · Review

Strictly chronological, sticky day headers (`Sat 14 Jun`). Default filter **Needs review**; chips for All / Needs review / Auto / Done / Skipped. Progress in the section bar: `18 of 42 reviewed`. `n` jumps to the next unreviewed row.

Row controls are what exists today (account picker, Fish Pie split, skip), plus a **save as rule** affordance for a one-off the user now wants remembered. The `AccountPicker` mounts only on interaction — resolved rows render as a compact label until clicked, which both calms the list and removes hundreds of heavy component instances.

### 5 · Confirm

A **verbose manifest** — this is the last look before anything is written to the ledger, so it earns the space:

```
187 transactions          Jun 3 – Jun 30
  → expenses:groceries      42     −1,284.50
  → expenses:transport      18       −212.05
  → assets:uncategorized     3        −47.80   ⚠
  …

12 skipped as duplicates                     [review]
 4 rows could not be parsed                  [details]
 3 import rules created
 2 accounts to be created
```

- **Per-account totals are the point.** They are the only thing that catches "everything landed in Uncategorized" *before* it is in the ledger; a bare row count cannot.
- Parse errors collapse behind a disclosure. Today they render as an uncapped `<ul>` (`ImportPreviewPanel.svelte:115`) — a malformed CSV puts hundreds of `<li>` above the table.
- Duplicates get one summary line instead of scattered per-row icons.
- Any row still missing an account is listed with a link that jumps back to it in Review. Today the gate is `error = 'All transactions must have accounts assigned.'`, which names none of them.

**On success, land on the imported range.** Commit currently navigates to a bare `/transactions`, whose default window has nothing to do with what was just imported. Navigate to `/transactions?from=<min>&to=<max>` — the page already reads both params (`transactions/+page.svelte:40-41`).

Use the min/max date of **committed** rows, not parsed rows. If the first week was skipped as duplicates, a range starting at the CSV's first date opens on a screen whose top is entirely rows the user did not just import, which defeats the purpose of landing there.

---

## Session state

Multi-step navigation means the state has to outlive a single component. The `beforeunload` guard at `import/+page.svelte:349` is already an admission of this.

Persist to `localStorage`, keyed by a hash of the CSV text, as plain serializable JSON:

```ts
type ImportSession = {
  version: 1
  fileHash: string          // sha-256 of the CSV text
  fileName: string
  step: 'file' | 'accounts' | 'sort' | 'review' | 'confirm'
  defaultCurrency: string
  // Currency code → account id. Replaces path-convention derivation; the single
  // source of truth for "where does this currency's money live", for both
  // single-currency (one entry) and multi-currency imports.
  currencyAccounts: Record<string, string>
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
- Stepper in the section bar; earlier steps clickable. Replace the `beforeunload` guard, which is now redundant.
- Move **Import as liabilities** to the File step as a derived chip with tooltip, override behind a disclosure.
- `handleCancel` becomes an explicit "discard this import?" confirmation — today it silently nulls `rowStates`.
- Review renders today's existing table unchanged — this story is the shell only.

Tests: round-trip a session through serialize/restore; assert commit clears it and a stale session is dropped.

### 5. Accounts step — real currency → account mapping

Replaces path-convention derivation with owned state. Touches the commit path, so it lands before the steps that build on it.

- `ImportSession.currencyAccounts: Record<string, string>`, seeded from the derived path (`<root>:<currency>`) where such an account exists, and left unset where it does not.
- Step UI: one `AccountPicker` row per currency in the CSV, pre-filled with the derived suggestion, freely re-pointable at any account. Gates advance while any currency is unmapped. Auto-skipped when every currency resolves on seed.
- Creating an account from this step passes `defaultCurrency` alongside `path`. Only `createAccount`'s body type in `frontend/src/lib/api.ts` needs widening — `POST /api/accounts` spreads the request body straight into the insert (`accounts.ts:328`), so the column already passes through. *(That spread accepts any column the client sends, `userId` excepted. Not this epic's problem, but worth a validated allow-list at some point.)*
- Delete `inferredPaths`, `missingPaths`, the missing-accounts banner, and the `oncreatemissing` / `oncreateallmissing` props. `handleConfirm`'s four `getInferredAccountId(...)` call sites read `currencyAccounts` instead. `accountIdForCurrency` survives only as the seeding helper.
- The single-currency `fromAccountId` picker moves out of the preview table header and becomes this step's single row; `importCommit`'s `accountId` is that row's value.
- The duplicate pre-check in `handleSubmit` also reads the map, so its per-row `accountId` matches what commit will actually use.

Tests: seeding fills existing currencies and leaves unknown ones blank; a hand-remapped currency is what commit posts to, not the derived path; the step gates while unmapped; an account created here carries `defaultCurrency`; a single-currency import commits to the mapped account.

### 6. Sort step

- Cluster rows by `merchantKey`; show clusters of 2+, sorted by count descending. Auto-skip the step when there are none.
- Cluster row: stem, count, date range, summed amount, target control (expense account or Fish Pie split), `remember` toggle — default on at 3+, off at 2.
- Expand to member rows in date order; a member can be excluded from the bulk assign.
- Already-matched clusters render greyed with a `matched by rule «pattern»` chip and expand for override.
- *Apply and continue* writes targets to member rows with `source: 'cluster'`, skipping `source === 'user'` rows; `override all N` includes them. `remember` clusters create active rules via `POST /api/rules`.

Tests: clustering groups near-duplicate descriptions and leaves singletons out; apply writes only untouched rows; override writes all; remember creates a rule of the right kind.

### 7. Review step

- Strictly chronological with sticky day headers. **Never regrouped.**
- Filter chips All / Needs review / Auto / Done / Skipped with live counts; default **Needs review**. Progress indicator in the section bar.
- `n` jumps to the next unreviewed row.
- Resolved rows render as a compact label; the `AccountPicker` mounts on click/focus.
- Any direct edit sets `source: 'user'`.
- Per-row **save as rule** *(absorbed from `import-rules-fish-pie.md` story 3)*: creates an active rule from the row's `merchantKey` plus whatever the user assigned — expense account or Fish Pie split — and applies it to remaining rows in this preview whose `source` is `'none'`.

Tests: filter counts match derived statuses; editing a row flips it to Done and out of the Needs-review filter; save-as-rule creates the right rule kind and back-fills only untouched matching rows.

### 8. Confirm step

- Manifest: per-destination-account totals with counts, date range, duplicates skipped, rules created, accounts to be created.
- Parse errors move here behind a disclosure, capped with an "N more" affordance.
- Incomplete rows listed with jump-back links into Review, replacing the unnamed blanket error.
- On success: clear the session, toast, confetti, then `goto('/transactions?from=&to=')` using the min/max date across committed rows only.

Tests: manifest totals match the row states they summarize; the incomplete list names exactly the rows `rowMissingAccounts` flags; the navigation range excludes skipped rows at the ends.

### 9. Manage Rules UI — split rules

*(absorbed from `import-rules-fish-pie.md` story 4)*

`/import/rules` renders and edits both rule kinds: a target column showing either an account path or `Group · Category`, and an editor that switches between the two target types.

---

## Sequencing

1 → 2 → 3 establishes the data and is invisible to the user. 4 is the shell and the natural PR boundary — everything after it depends on the store. 5 lands next because it rewrites the commit path and everything downstream should be built against the map, not the convention. 6, 7, 8 are the remaining steps in order. 9 closes the loop on rule management.

## Stretch / out of scope

- **Currency aliasing ("post as")** — a bank may label a currency with a non-ISO name: a Wise CSV emitting `RMB` for what is really `CNY`. The Accounts step lets the user point `RMB` at their existing `assets:wise:cny` account, which solves the placement problem, but postings are still written with `currency: 'RMB'`. That account then carries two balances that never net, and FX rates stored against `CNY` won't apply to half of it. The fix is an optional per-row "post as" override on the mapping, applied when building `tx.currency` at commit. **Deferred** — not a live case in the user's data today, and the mapping step is what makes it a one-field addition whenever it becomes one.
- **Mine split rules from history** — extend `POST /api/rules/mine` to suggest split rules from transactions with a Fish Pie leg. (`import-rules-fish-pie.md` story 5.)
- **Backend `import_sessions`** — server-side session state so an import survives a device switch. Own epic; the state shape above is designed to make it a transport change.
- **Keyboard triage mode** — a single-row focused mode with type-to-assign. Revisit once the step split has had real use.
- **Editable descriptions during import** — [`import-description-backfill.md`](import-description-backfill.md) (Backlog) wants exactly the merchant stems story 1 computes. Worth a pointer in that epic once `merchantKey` exists, rather than scope here.
