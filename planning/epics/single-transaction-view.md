# Epic: Single-transaction view — legible multi-posting display + smart edit

Goal: Make a complex, multi-posting transaction **readable** and **safely editable**, and
turn that into one shared component reused everywhere a transaction is shown. A
cross-currency Wise spend (4–5 postings) should *narrate* what happened instead of dumping
raw legs, let the user recategorize the meaningful spend without touching the balancing
legs, and the same component should back the spending page's right panel.

## Background

A real transaction — spending 50 EUR via Wise while out of EUR, so Wise also did an
on-the-fly conversion — is one envelope with 4–5 postings:

- `assets:wise:cad` → `assets:wise:eur` (80 CAD → 50 EUR) — the account-to-account move
- `equity:conversion` — the rate-balancing leg
- `expenses:banking:fee` — the Wise fee
- `expenses:food:cafe` — the actual spend

Today the edit modal renders this as a flat list of postings. Three problems:

1. **Unreadable.** All legs look equal. The mechanical ones (conversion, fee, transfer)
   bury the one leg the user cares about — the spend.
2. **Unsafe edit.** To recategorize `expenses:food:cafe` → `expenses:food:restaurants`
   the user hand-edits raw postings. Easy to unbalance the entry.
3. **Duplicated markup.** The detail/edit view is one-off modal markup; the spending page
   right panel re-implements its own. They drift.

There is a **shared root cause with the spending-page P0 bug** ("amounts don't add up",
TASKS.md): the right-panel totals mis-handle the mechanical / mixed-currency postings.
The same classification that makes this view legible — *which legs are meaningful spend vs
mechanical* — is what the summing logic needs to stop double-counting. Fix it once here.

> **Scope split.** This epic *reads and sums* existing transactions correctly. The
> separate problem — the importer *creates* malformed cross-currency-spend transactions
> (no `equity:conversions` bridge, spend dumped into the target asset account, phantom
> balances) — is spun out to its own high-priority epic,
> [Cross-Currency Spend Import + Heal](cross-currency-spend-import.md). This epic's
> classifier (story 1) must still tolerate already-imported malformed shapes and ideally
> flag them; the import epic stops new bad data and heals old.

## Core idea — posting roles

Every posting gets a derived **role**, classifying it within its transaction:

| role | meaning | example |
|------|---------|---------|
| `spend` | meaningful expense/income leg | `expenses:food:cafe`, `income:salary` |
| `transfer` | asset↔asset / asset↔liability move | `assets:wise:cad` ↔ `assets:wise:eur` |
| `conversion` | FX rate-balancing | `equity:conversion` |
| `fee` | bank/transfer fee | `expenses:banking:fee` |
| `share` | Fish Pie clearing leg | `assets:receivable:<slug>` |

**Decision to make (story 1):** derive role at read time from the account root +
transaction shape (heuristic, zero schema change, may misclassify unusual setups), **or**
add a nullable `role` column to `postings` written at build time (explicit, accurate,
needs a migration + backfill). Recommendation: **start heuristic** — it unblocks the sum
fix and the display with no migration, and a stored role can layer on later if the
heuristic proves too fragile. The heuristic keys off the user's configurable root paths
(`defaultExpensesRootPath`, `defaultEquityRootPath`, fee/conversion accounts in
`userSettings` / `csvParsers`) so it respects per-user account naming.

Once roles exist, both the **display** (group mechanical legs, surface the spend + rate)
and the **summing** (count only `spend` legs in the user's currency) follow from them.

---

## Stories

### 1. Posting role classification + fix the spending sum bug  🐛 P0

Backend. The load-bearing story — ships the bug fix.

- Add a `classifyPostings(transaction, postings, settings)` helper (backend
  `src/postings/roles.ts` or similar) returning each posting's role per the table above.
  Heuristic by account root, using the user's configured root paths and fee/conversion
  accounts. Pure function, exhaustively unit-tested against the canonical shapes: plain
  2-leg, Fish Pie 3-leg, same-currency Fish Pie, cross-currency conversion, fee-bearing
  Wise spend.
- **Fix the spending total** (`backend transactions.ts` aggregation feeding the spending
  page / `SpendingSummaryPanel`): sum only `spend`-role legs, converted to preferred
  currency. Mechanical legs (`transfer`/`conversion`/`fee`/`share`) are excluded so a
  cross-currency spend counts once at its true expense amount, not doubled by the
  conversion legs.
- **Regression test reproducing the bad total:** seed the canonical Wise cross-currency
  spend, assert the spending aggregate equals the single expense amount (not the inflated
  sum). This test must fail on `main` and pass after the fix.

Tests: `classifyPostings` unit table; spending aggregate regression on the multi-currency
shape; confirm plain transactions are unaffected.

---

### 2. Read-only narrated transaction view (shared component)

Frontend. A new `TransactionDetail.svelte` that renders a transaction by role, not as a
flat posting list.

- Group display: lead with the **spend** leg(s) (account + amount, prominent). Collapse
  the mechanical legs (`transfer`/`conversion`/`fee`) into a secondary "how it moved"
  section — show the cross-currency flow (`80 CAD → 50 EUR`) plus the fee, in plain
  language rather than signed raw postings. **No effective-rate line in v1** (low value;
  can layer on later if wanted).
- Fish Pie `share` legs render as "split with <group>" rather than a raw
  `assets:receivable:*` posting.
- Plain 2-posting transactions render simply (no over-design for the common case).
- Pure presentation — consumes the role classification (story 1) exposed on the
  transaction read payload.

Tests: component renders each canonical shape; the Wise example shows one spend line + a
grouped mechanical section with the rate; a plain transaction shows the simple form.

---

### 3. Smart edit — recategorize the spend without unbalancing

Frontend + backend. Replace the raw-posting hand-edit for the common change.

- In the edit surface, expose the **meaningful** fields directly: the spend leg's account
  (recategorize), description, date. The mechanical legs are shown read-only ("how it
  moved") and are **not** hand-editable in this mode.
- Recategorizing the spend = repoint that one posting's `accountId`; balance is untouched
  because amounts don't change. Backend validates the entry still balances per currency
  before persisting (reject otherwise).
- Keep an **"edit raw postings" escape hatch** (the existing `TransactionEditModal` /
  `PostingEditorRow` flow) for power edits and for transactions the heuristic can't
  confidently narrate — don't strand any transaction.

Tests: recategorize the cafe leg → restaurants, assert only that posting's account
changed and the entry still balances; assert a balance-breaking edit is rejected; the raw
escape hatch still edits arbitrary legs.

---

### 4. Reuse on the spending page right panel

Frontend. Swap the one-off spending right-panel markup
(`SpendingSummaryPanel` / `SpendingTxnRow`) over to the shared `TransactionDetail`
component from story 2.

- The right panel shows the narrated view instead of bespoke markup; clicking a spend row
  opens the same detail used elsewhere.
- Delete the duplicated markup once parity is confirmed.

Tests: spending page renders the shared component; selecting a multi-posting transaction
shows the narrated detail and the panel total matches the story-1 fix.

---

## Sequencing

Story 1 first and standalone — it carries the P0 spending-sum fix and the classification
everything else needs; it can ship as its own PR ahead of the UI. 2 → 3 build the view and
its edit. 4 collapses the duplication. If the heuristic in story 1 proves too fragile in
real use, a stored `postings.role` column is the fallback — additive, no rework of the
consumers.

## Resolved decisions (settled 2026-06-23)

- **Heuristic, not a stored column.** No migration. Stored `postings.role` is the fallback
  only if the heuristic proves fragile in real use — additive, no consumer rework.
- **Classifier keys.** Role from configured fee/conversion accounts (`userSettings` /
  `csvParsers`) **plus** account-root matching: `expenses:` → `spend`, `equity:` →
  `conversion`, `assets:` ↔ `assets:`/`liabilities:` → `transfer`. `share` keys off the
  hardcoded `assets:receivable:` prefix for now (it's hardcoded elsewhere too — revisit
  when that's generalized, not in this epic).
- **No effective-rate display in v1.** Show the flow + fee only. Add rate later if wanted.
- **No home-currency `≈` hint required** on the spend line in v1 (optional polish).
- **Smart-edit v1 scope** = recategorize spend account + description + date. Raw-posting
  modal stays as the escape hatch for everything else and for shapes the heuristic can't
  confidently narrate. Don't strand any transaction.
- **Malformed imports.** Story 1's classifier must not crash on the broken
  cross-currency-spend shape (expense account used as the FX bridge, spend in the target
  asset account); where detectable, mark the transaction as malformed so the import epic's
  heal step can find it. Creating-side fix + healing live in
  [Cross-Currency Spend Import + Heal](cross-currency-spend-import.md).
