# Epic: Fish Pie — Cross-Currency Settlement (web)

**Goal:** Replace the per-currency "Settle up" buttons on the group balance panel
with a single **Settle up** action that opens a batch flow. The flow lists every
debt the current user owes across all currencies and lets them settle each line
either **natively** (pay EUR for an EUR debt) or **converted to a home currency**
(pay CAD for an EUR debt, via FX). Settling produces **one combined cash
transaction** in the ledger while still recording **one settlement row per debt
currency**, so the existing balance math is untouched.

This supersedes the old invariant ("currencies settle independently") from the
archived `fish-pie-balances` / `mobile-companion-balances` epics. That invariant
holds for the *balance computation* but no longer for the *cash leg*.

## The bug that motivated this

When a group has a balance in >1 currency, `GroupBalancePanel.svelte` renders one
`Settle up` / `Waiting for … to pay` button per currency with **no currency or
amount in the label** — so the buttons are visually identical and indistinguishable.
The deeper need: the user travels (home currency CAD) and wants to wipe a mixed
EUR+CAD balance in a single CAD payment.

## Two scenarios this must support

1. **Consolidated** — owe 500 CAD + 50 EUR. Pay **580 CAD** total (50 EUR converted
   at the FX rate). One bank movement, balance wiped clean in both currencies.
2. **Native** — both partners still hold EUR. Settle **500 CAD** and **50 EUR**
   separately in their own currencies. (This is today's behavior, preserved.)

A single batch can mix the two per line (partial batch — see below).

## Worked example (consolidated, owe 500 CAD + 50 EUR, pay 580 CAD @ 1.60)

**Payer transaction — one combined tx, balances per-currency:**

```
payerAccount            -580.00 CAD     ← single bank movement
shared:group(payer)     +500.00 CAD     ← CAD debt, native
shared:group(payer)      +50.00 EUR     ← EUR debt, balance-offset leg
equity:conversions       +80.00 CAD     ← FX bridge
equity:conversions       -50.00 EUR
```

CAD legs: −580 + 500 + 80 = 0 ✓  EUR legs: +50 − 50 = 0 ✓
Mechanically identical to the cross-currency transfer bridge in
`routes/import.ts:357-421` (`equity:conversions` straddles both currencies).

**Receiver confirm — mirror, one combined tx:** receiver gets +580 CAD cash,
drains *their own* receivable in CAD+EUR, books the symmetric conversion on *their*
`equity:conversions`. Economically correct: they were owed 50 EUR, accepted 80 CAD.

## Design decisions (locked)

- **Per-currency settlement rows preserved.** Each debt currency still produces a
  `groupSettlements` row with `amount`/`currency` in the *debt* currency, so
  `computeCurrencyBalances` (`fish-pie-balance-service.ts:85`) zeroes that currency
  exactly as today. The conversion lives only in the ledger postings, never in the
  netting.
- **One combined cash transaction.** All rows in a batch share one
  `payerTransactionId` (the FK is already nullable + non-unique → no schema change
  needed for the link) and a new `batchId`. The payer's bank sees a single movement.
- **FX rate: prefill from cache, editable.** Default from the `fxRates` cache /
  frankfurter, fetching the most recent available day (frankfurter has no same-day
  rate). Show a hint `EUR → CAD rate as of {asOfDate}`. The user can overwrite the
  converted amount with what their bank actually charged.
- **Partial batch.** Each line has an include toggle — settle some currencies now,
  leave others (e.g. pay CAD, keep EUR).
- **Native single-line settlement == today's behavior** (no FX columns, no bridge).
  Backward compatible.

## Schema delta — `groupSettlements` (all new columns nullable; null = native)

- `settledAmount numeric(12,2)` — actual cash paid for this line (e.g. `80.00`).
  Null ⇒ equals `amount` (native).
- `settledCurrency text` — cash currency (e.g. `CAD`). Null ⇒ equals `currency`.
- `fxRate numeric(12,6)` — rate used (audit/display). Null for native lines.
- `batchId uuid` — groups rows settled together; drives combined confirm + delete.

The existing `amount`/`currency` keep meaning the **debt** being cleared.

## FX accounts

- Payer's conversion account = `userSettings.defaultConversionAccountId` (resolved at
  create). Receiver's = theirs (resolved at confirm). Error if unset (mirrors how
  `import.ts` requires a `conversionAccountId` for transfers).
- Shared account per user via existing `ensureSharedAccount(userId, group, tx)`.

---

## Stories

### Story 1 — FX "as-of" rate helper + schema columns

- **`getRateAsOf(baseCurrency, quoteCurrency)`** in `routes/fx-rates.ts` (or a small
  shared module): walks back from *yesterday* (`today − 1`) up to ~7 days, calling the
  existing `getOrFetchRate(date, …)` until it returns non-null. Returns
  `{ rate, asOfDate }` or `null` if nothing found in the window. Caching is handled by
  `getOrFetchRate` (stores under the requested date).
- Expose it: extend `GET /api/fx-rates` (or add `GET /api/fx-rates/as-of?from=&to=`)
  to return `{ from, to, rate, asOfDate }` so the modal can prefill + show the hint.
- Add the four nullable columns to `groupSettlements`; `db:generate` then **both**
  `db:migrate` and `db:migrate:test`.

**Tests:** `getRateAsOf` returns yesterday's rate when present; walks back over a
weekend/holiday to the last business day and reports the correct `asOfDate`; returns
null past the window; endpoint shape; new columns nullable + default null.

### Story 2 — Batch settlement create endpoint

`POST /api/fish-pie/groups/:groupId/settlements/batch`
Body: `{ payerAccountId, date, note?, lines: [{ toUserId, debtAmount, debtCurrency,
settledAmount, settledCurrency, fxRate? }] }`.

- Auth: caller must be a group member and the payer (`fromUserId === userId`) for
  every line.
- Validate each line (positive amounts, member `toUserId`, currencies, payer account
  ownership). A line is **native** when `settledCurrency === debtCurrency` (then
  `settledAmount` must equal `debtAmount`); otherwise it's **converted** and requires
  a positive `fxRate` and the payer's `defaultConversionAccountId` to be set.
- In one DB transaction: generate a `batchId`; build **one** payer `transactions`
  row; emit postings — the single cash leg (`−Σ settledAmount` grouped by
  `settledCurrency`), one `shared:group` credit per debt line in its debt currency,
  and `equity:conversions` legs bridging each converted line (per the worked example,
  reusing the `import.ts` math). Insert N `groupSettlements` rows (status `pending`)
  all sharing `batchId` + `payerTransactionId`, storing `settledAmount`/
  `settledCurrency`/`fxRate`.
- Keep the existing single `POST …/settlements` endpoint working (or reimplement it
  as a one-native-line batch — decide during build; note which).

**Tests:** native-only batch matches old behavior + balances unchanged until confirm;
converted line produces balanced per-currency postings (CAD sum 0, EUR sum 0) and the
`equity:conversions` bridge; mixed batch = one combined cash tx with all rows sharing
`batchId`/`payerTransactionId`; converted line without `defaultConversionAccountId`
→ 400; non-payer → 403; settled≠debt amount on a native line → 400.

### Story 3 — Batch confirm + batch-aware delete

- `POST /api/fish-pie/groups/:groupId/settlements/batch/:batchId/confirm`
  Body `{ receiverAccountId }`. Receiver-only. Builds **one** combined receiver
  `transactions` (mirror legs + receiver's own `equity:conversions` for converted
  lines), marks every row in the batch `completed` with the shared
  `receiverTransactionId`. Balances update on refresh.
- **Delete** by batch: deleting any row (or a batch) soft-deletes all rows in the
  batch + the linked payer/receiver transactions and their postings (extend the
  existing single-settlement DELETE to cascade across `batchId`).

**Tests:** only the receiver can confirm; confirm books one combined receiver tx and
flips all rows to completed; balances reflect completion after refresh; payer sees no
confirm for their own batch; deleting a batch soft-deletes all rows + both txs +
postings; confirming an already-completed batch → 409.

### Story 4 — Frontend: single "Settle up" → batch modal

- `GroupBalancePanel.svelte`: collapse the per-currency button list into **one**
  `Settle up` (when the current user owes anything) / `Waiting for {name} to pay`
  (when they're owed). The current per-currency buttons (lines 63–85) go away.
- New batch modal (evolve `GroupSettleModal.svelte` or a new `GroupSettleBatchModal`):
  - Pre-load every transfer where the current user is the debtor, across currencies.
  - One **target currency** selector, default `userSettings.preferredCurrency`.
  - Each line: include toggle (partial batch) + native/convert toggle. Converted lines
    prefill `settledAmount` from `getRateAsOf` and show the hint
    `{from} → {to} rate as of {asOfDate}` (editable amount).
  - One `payerAccountId` + `date` + `note?` for the batch. Submit → batch endpoint.
- Confirm action for the receiver surfaces per batch (banner / settlements list).

**Tests (frontend `check` + component where feasible):** single Settle-up shown for a
multi-currency debt; modal lists all owed currencies; toggling convert recomputes the
cash amount from the prefilled rate; excluded lines are omitted from the payload;
target-currency default = preferred currency; native-only submit unchanged.

---

## Out of scope

- Editing settlements beyond create/confirm/delete.
- Auto-refreshing FX rates after the modal opens (fetch once on open).
- Mobile companion parity — this epic is the **web** flow; mobile follows separately.
- Reverse direction (paying a CAD debt in EUR) is *supported by the model* but the
  UX defaults the target to the home currency; arbitrary per-line target currency is
  a possible later tweak.

## Notes

- Iterate on the modal UX after the core create/confirm path lands (user's call).
- `equity:conversions` is the same account used by `import.ts` cross-currency
  transfers and the `currency-transfers` epic — keep the posting convention identical
  for consistency in the exported hledger journal.
