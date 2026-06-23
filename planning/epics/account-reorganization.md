# Epic: Account reorganization — rename, merge, split, move

Goal: Give the user a dedicated surface to reorganize their account tree —
rename/re-path, merge, split, and move accounts — without orphaning transactions or the
many records that reference an account. Today account paths are effectively permanent:
there's no way to fix a naming mistake or restructure categories after the fact.

## Background — the data model favors us

Accounts are a **first-class table** (`accounts`), id = UUID PK, `path` a colon-separated
materialized path that doubles as the hledger account name. Crucially, **postings FK to
`accounts.id`, not to the path string** (`postings.accountId`). Consequences:

- **Renaming a leaf is a single `UPDATE accounts.path`.** Every posting keeps pointing at
  the same id, so nothing needs re-pointing. Cheap and safe.
- **The tree is materialized, not relational.** `expenses:food` and `expenses:food:cafe`
  are two independent rows; there is no parent FK. So a *parent* rename must cascade by
  string: update every row where `path = parent OR path LIKE 'parent:%'`, rewriting the
  prefix.
- **Path uniqueness is app-layer only** (no DB unique constraint). So rename/merge must
  check for collisions in code, and a rename *onto an existing path* is a merge, not an
  error.

**Many tables hold an `accountId` FK** and must stay consistent on merge/delete (rename is
transparent to them since the id is stable):

`postings`, `csvParsers` (`defaultAccountId`, `defaultFeeAccountId`), `userSettings`
(`defaultOffsetAccountId`, `defaultConversionAccountId`, `defaultAdjustmentsAccountId`),
`importRules` (`accountId`), `expenseGroupMembers`
(`defaultExpenseAccountId`, `defaultPaymentAccountId`), `groupCategoryMemberAccounts`
(`accountId`), `groupSettlements` (`payerAccountId`).

**Fish Pie clearing accounts** (`assets:receivable:<slug>`) are *re-derived* at import via
`ensureSharedAccount(group)`. Renaming one just makes the next import respawn the
original. Treat receivable accounts as system-managed — exclude them from manual reorg (or
warn hard).

This favorable model is why **Phase 1 (rename/re-path) can ship as a small standalone PR**
ahead of the heavier merge/split work.

---

## Stories

### 1. Rename / re-path a leaf account

Backend + Frontend. The simplest, highest-value slice.

**Backend** — `PATCH /api/accounts/:id` (or a dedicated `/rename`):
- Rename a leaf path (`expenses:food:cafe` → `expenses:food:coffeeshop`). Single
  `UPDATE accounts.path`; postings unaffected (stable id).
- Reject if the target path already exists (collision → that's a merge, story 3) or is a
  `assets:receivable:*` system account. Validate ownership.
- Updating only `name` (the display label) is already supported — this adds true `path`
  rewrite, distinct from the cosmetic name.

**Frontend** — a Manage Accounts surface (new route, e.g. `/accounts/manage`) listing the
tree with a rename action per node.

Tests: rename a leaf, assert the path changed and the same postings now resolve under the
new path; rename onto an existing path is rejected; receivable accounts rejected;
cross-user rename rejected.

---

### 2. Rename a parent segment (cascade)

Backend + Frontend. Extend rename to non-leaf nodes.

- Renaming `expenses:food` → `expenses:dining` rewrites the prefix on the node **and every
  descendant** (`expenses:food:cafe` → `expenses:dining:cafe`, etc.). One transactional
  bulk update over `path = parent OR path LIKE 'parent:%'`, rewriting the leading segment
  only (anchor the match so `expenses:foodcourt` is untouched).
- Collision check across the whole moved subtree: if any rewritten path would equal an
  existing account's path, it's a merge — block in Phase 1 and surface the conflicting
  paths (full merge is story 3).
- Frontend: rename on a parent node warns "this also renames N child accounts" with the
  list before applying.

Tests: parent rename cascades to all descendants in one transaction; a non-descendant with
a similar prefix is untouched; a cascade that would collide is rejected with the offending
paths.

---

### 3. Merge accounts

Backend + Frontend. Phase 2.

- Fold a source account into a destination (`expenses:health:medical` +
  `expenses:health:pharmacy` → one), and treat "rename onto an existing path" as a merge
  too.
- Repoint **every** `accountId` FK from source → destination across all referencing tables
  (the list in Background), then soft-delete the source (`deletedAt`). Single transaction.
- A confirmation/preview step: show how many postings + which settings/rules/group rows
  will be repointed before committing. Irreversible-ish (soft-delete leaves a trail) —
  require explicit confirm.
- Refuse to merge a `assets:receivable:*` account (system-managed).

Tests: merge repoints postings and each referencing FK table; source ends soft-deleted;
destination balance equals the pre-merge sum of both; merging into a receivable account is
rejected; preview counts are accurate.

---

### 4. Split an account (per-transaction reassignment)

Backend + Frontend. Phase 2, the heaviest.

- Break `expenses:food:coffeeshop` into `expenses:food:coffee` + `expenses:food:bakery`,
  then **choose which transactions go where** — per-row reassignment, optionally
  rule-assisted (reuse `cleanDescription` + import-rule matching to bulk-suggest).
- Create the new destination accounts as needed; repoint each selected posting's
  `accountId`; leave the original (possibly emptied, then optionally archived).
- Preview before apply; nothing commits until the user confirms the assignment.

Tests: split moves the selected postings to the chosen destinations and leaves the rest;
rule-assisted bulk-assign groups matching descriptions; preview matches the applied result;
balances are conserved across the split.

---

### 5. General move / reparent

Backend + Frontend. Phase 2 capstone — reparent a node (and its subtree) elsewhere in the
tree (`expenses:food:cafe` → `expenses:dining:cafe` under a different parent). Mechanically
a prefix-rewrite like story 2 plus a merge-on-collision like story 3; build last, on top of
their primitives. May be folded into story 2's cascade if the implementation generalizes.

Tests: reparent moves the subtree; collision at the destination is handled as a merge;
balances conserved.

---

## Sequencing

Stories 1 → 2 are **Phase 1** and ship together (or 1 alone) — pure path rewrites, no FK
sweeps, low risk, immediate value. Stories 3 → 4 → 5 are **Phase 2** — they touch every
referencing table and need preview/confirm UX; do them after Phase 1 is in use. Story 4
(split) is the hardest and benefits from the [Single-transaction view](single-transaction-view.md)
and import-rule matching landing first (per-row reassignment UX).

## Open questions to settle before Phase 2

- **Receivable accounts** — confirm "system-managed, excluded from reorg" is acceptable,
  or do we need a way to rename a Fish Pie group's clearing path (which means renaming the
  group slug / `ensureSharedAccount` derivation, a bigger change)?
- **Budgets / other derived consumers** — audit anything else keyed on account *path*
  (not id) that a rename would break. Spending-page groupings key on path prefixes —
  verify they follow a rename cleanly.
- **Undo** — soft-delete gives a trail on merge, but is a real "undo last reorg" needed,
  or is preview-before-apply sufficient?
- **hledger export** — renames change the exported account name; fine as a snapshot, but
  confirm no expectation of rename history in the journal.
