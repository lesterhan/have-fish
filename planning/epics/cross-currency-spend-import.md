# Epic: Cross-currency spend import + heal — correct FX-funded spends, fix the bad ones

Goal: Import a **spend made in a currency you don't hold** correctly — the Wise card
payment that auto-funds from another balance via on-the-fly conversion — so it balances
through `equity:conversions` like a real conversion does, records the spend once at its
true expense account, and leaves **no phantom balance**. Then **heal** the malformed
transactions already in the database from before this fix.

This is the *creating* side of the problem. The
[Single-Transaction View](single-transaction-view.md) epic is the *reading/summing* side;
its classifier tolerates and flags the bad shape, this epic stops producing it and repairs
the existing ones.

## Background — the gap and the bug

The importer has three transfer paths (`backend/src/routes/import.ts`):

- **cross-currency transfer** (`isTransfer === true`) — asset→asset via `equity:conversions`
- **same-currency transfer** (`isTransfer === 'same-currency'`) — asset→asset, one currency
- **regular** — single account → expense/income, one currency

**None handles asset(A) → expense(B): a spend in a currency you don't hold.** Scenario:
buy coffee for 360 CZK, CZK balance is empty, Wise pulls 17.29 USD, converts to 360 CZK
(17.24 USD + 0.05 USD fee), and the 360 CZK is *spent*, not parked.

The transaction that exists today for this is malformed — it reuses the **expense account
as the FX bridge** and dumps the spend into the **target asset account**:

```
assets:bank:savings:usd   -17.29 USD
expenses:food:coffee      +17.24 USD   ✗ should be equity:conversions
expenses:banking           +0.05 USD   (fee — fine)
expenses:food:coffee     -360.00 CZK   ✗ should be equity:conversions
assets:bank:savings:czk  +360.00 CZK   ✗ should be expenses:food:coffee
```

Two corruptions:

1. **Phantom asset** — `savings:czk +360 CZK` claims a holding that was spent. Net worth wrong.
2. **Spend double-booked across currencies, opposite signs** (+17.24 USD and −360 CZK ≈
   cancel) — cross-currency spending totals double or zero out. This is the spending-page
   P0 ("amounts don't add up").

### Correct shape

Mirror the conversion path, but the **target leg is the expense** (the spend), not an asset:

```
assets:bank:savings:usd   -17.29 USD   source asset out (gross incl. fee)
expenses:banking           +0.05 USD   fee, source currency
equity:conversions        +17.24 USD   FX bridge, source side  = −(source + fee)
equity:conversions       -360.00 CZK   FX bridge, target side
expenses:food:coffee     +360.00 CZK   the spend, single clean leg
```

USD: −17.29 + 0.05 + 17.24 = 0 ✓ · CZK: −360 + 360 = 0 ✓ · coffee = one 360 CZK expense,
no phantom asset. Structurally this is the existing cross-currency transfer with the
target account swapped from an asset to an expense — one knob.

---

## Stories

### 1. Backend: cross-currency-spend posting builder + import path  🐛 P0

Backend. The create-side fix — produces the correct shape.

- Add `buildCrossCurrencySpendPostings(...)` to `backend/src/import/postings.ts`. Inputs
  mirror the cross-currency transfer (`sourceAccountId`, `sourceAmount`, `sourceCurrency`,
  `conversionAccountId`, `conversionSrcAmount`, `targetAmount`, `targetCurrency`, optional
  fee) but the final leg posts `+targetAmount` to an **`expenseAccountId`**, not a target
  asset. No group split (that's Fish Pie's path).
- Add the import row type + branch in `import.ts`: a transfer-shaped row whose target is an
  expense account. Reuse `conversionSrcAmount = −(srcAmount + feeVal)`, `equity:conversions`
  as the bridge on both currency sides. Validate per-currency balance before insert.
- Pure builder, exhaustively unit-tested: with fee / without fee; assert both currency
  sides sum to zero; assert the bridge legs are `equity:conversions` (not the expense
  account) and the spend lands in the expense account (not an asset).

Tests: builder table; import-route integration seeding the canonical Wise CZK coffee row,
asserting the 5-posting correct shape and balance; confirm no phantom asset leg.

---

### 2. Import wizard: detect + capture FX-funded spend rows

Frontend + backend parser. Give the import flow a way to *produce* a story-1 row.

- In the import wizard, a spend row whose settlement currency differs from the funding
  account's currency can be marked **"funded by conversion from <account>"**, capturing the
  source amount, source currency, fee, and the expense category for the spend.
- Where the bank CSV makes it inferable (Wise exports the source amount + fee on the card
  row), pre-detect and pre-fill; otherwise the user sets it explicitly. Don't auto-commit a
  guessed conversion — surface it for confirmation.
- Round-trips through the story-1 path.

Tests: wizard emits the cross-currency-spend row shape; parser maps a Wise card-payment row
with a foreign settlement currency to the right fields.

---

### 3. Heal existing malformed cross-currency-spend transactions

Backend + frontend. Repair what's already in the DB.

- **Detector**: a transaction is a malformed FX-funded spend when it has no
  `equity:conversions` leg, the same **expense** account appears in two currencies with
  opposite signs, and a **target asset** account holds the target-currency amount with no
  real basis. Reuse / extend the Single-Transaction-View classifier's malformed flag.
- **Repair transform** — pure `accountId` repoint, amounts untouched, balance preserved:
  - expense account's source-currency leg → `equity:conversions`
  - expense account's target-currency leg → `equity:conversions`
  - target-asset leg → the expense account
  This yields exactly the story-1 correct shape. Reversible in principle (3 account swaps).
- **Surfacing** — see open question below; recommended: classifier flags it in the
  Single-Transaction view, user repairs **one-click with a before/after preview**
  (human-in-the-loop, since detecting "phantom asset vs genuine convert-and-hold" is a
  heuristic).

Tests: detector matches the canonical bad shape and rejects a genuine convert (asset→asset,
already has `equity:conversions`); repair produces the correct 5-posting shape and the entry
still balances; idempotent (repairing twice is a no-op); a healthy transaction is never touched.

**Shipped (PR #107):** pure detector + 3-account repoint, `GET /malformed-fx-spend` (preview)
+ `POST /:id/heal-fx-spend`, and a repair banner/modal on the Transactions page.

---

### 3b. Surface repair on the account pages via the attention indicators

Frontend + backend. The Transactions page is "all transactions" and too noisy; the user
lives in the per-account asset/liability pages. Surface the repair need there, reusing the
existing **action-required** indicators (account-page ⚠ chip + sidebar dot).

- **Unified attention count** (decided): the malformed-spend transactions fold into the same
  `action-required` count, attached to the **balance accounts they touch**. One indicator —
  `GET /accounts/action-required-summary` and `/:id/action-required` union uncategorized +
  malformed tx-ids; the per-account endpoint also returns `malformedTransactionIds` so the
  row can offer a Repair action.
- **Louder indicator** (decided): the resting (untoggled) `warning` `GradientButton` gets an
  amber fill + a soft pulsing halo (respects `prefers-reduced-motion`) — previously it only
  coloured when the filter was active, so it read as muted grey at rest.
- **Per-row repair**: malformed rows on the account page show an inline "needs repair" strip
  that opens the shared `RepairFxSpendModal` scoped to that account.

Tests: summary/per-account endpoints attach malformed spends to the right balance accounts
and clear after healing; `malformedTransactionIds` returned; existing uncategorized
action-required behaviour unaffected.

---

## Resolved decisions

- **Heal delivery = A (decided 2026-06-23).** Classifier-flagged one-click repair with a
  before/after preview — human reviews each, the transform is a clean 3-account repoint,
  leverages the single-txn classifier's malformed flag. The repair transform ships as a
  pure tested service isolated from the UI, so a future batch mode (B) can reuse it if the
  volume ever turns out large. Rejected B (batch, no review — risks misclassifying a genuine
  convert-and-hold) and C (manual re-import — loses manual edits, most toil).

## Open questions to settle

- **Wizard detection depth (story 2).** Full auto-detect from the Wise CSV's source-amount/
  fee columns, or start with explicit user marking and add auto-detect once we see real
  exports? Confirm which bank CSVs carry enough columns to infer the conversion.
- **Genuine convert-and-hold ambiguity.** A real asset→asset conversion that legitimately
  parks money in `savings:czk` must never be flagged for heal. The detector's guard is the
  presence of an **expense** account on both currency sides — confirm that signature can't
  collide with any legitimate shape we produce.
