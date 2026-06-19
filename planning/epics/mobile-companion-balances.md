# Epic: Pocket Companion — Balances & Settlement (Companion 3 of 4)

**Goal:** Rebuild the Balances tab to the design — one soft-gloss card **per
currency** showing each member's signed net, a "to settle" sentence, and a
settle action — and bring the **cross-currency batch settlement** flow that
shipped on web (`GroupSettleBatchModal`) to mobile. Balances render straight from
`fetchBalances` (no client-side math). Settlement keeps the backend's two-step
**pending → confirm** model (decision locked) rather than the prototype's one-tap
instant-complete.

Builds on Epic 1 (theme, gloss primitives, `BottomSheet`, shell) and the pure-
helper / bun-test convention from Epic 2.

## Design reference

- **Screenshot:** `.design/balances-tab.png`
- **Handoff:** `.design/handoff/README.md` — section *Screen: Balances* (the
  balance-math block there is **illustrative**; the backend already computes it).
- **Prototype:** `.design/handoff/companion/screens-more.jsx` (Balances). Note the
  prototype shows a one-tap COMPLETED settle with **no currency conversion** — we
  deviate: two-step pending, plus a batch convert flow the prototype doesn't cover
  (model it on the web `GroupSettleBatchModal`, rendered as a native bottom sheet).

## Backend — already shipped, no backend work

The cross-currency settlement web epic (`archive/fish-pie-cross-currency-settlement.md`)
landed every endpoint mobile needs:

- `POST …/groups/:groupId/settlements/batch` — creates **pending** rows sharing a
  `batchId` + one combined payer transaction. Body:
  `{ payerAccountId, date, note?, lines: [{ toUserId, debtAmount, debtCurrency,
  settledAmount, settledCurrency, fxRate? }] }`. A line is **native** when
  `settledCurrency === debtCurrency` (then `settledAmount` must equal `debtAmount`);
  otherwise **converted** — requires a positive `fxRate` and the payer's
  `defaultConversionAccountId`. Returns `{ batchId, settlements }`.
- `POST …/settlements/batch/:batchId/confirm` — receiver-only; books one combined
  receiver transaction, flips every row to `completed`. Body `{ receiverAccountId }`.
- `DELETE …/settlements/:settlementId` — cascades across the whole `batchId`.
- `GET /api/fx-rates/as-of?from=&to=` → `{ from, to, rate, asOfDate }` (most recent
  published rate, walks back ~7 days).
- `groupSettlements` rows already carry `batchId / settledAmount / settledCurrency /
  fxRate` and the overview endpoint returns them via `select()`.

The legacy single `POST …/settlements` endpoint still works; mobile moves to the
batch endpoint for all settlement creation (a native-only batch == the old behavior).

## Decisions (locked)

- **Do not recompute balances on the client.** Render `CurrencyBalance[]`
  (`netPositions` + `transfers`) directly from `fetchBalances`.
- **Two-step, not one-tap.** Mobile records a **pending** batch; the **receiver**
  confirms. Copy must not claim "settled" before confirmation — use
  "Recorded — awaiting {receiver}".
- **Target currency default = `userSettings.preferredCurrency`** (web parity). Mobile
  gains a `fetchUserSettings` call; fall back to the Epic-2 sticky
  `havefish_last_currency_{groupId}` if preferred is unset.
- **Debt lines settle in full.** Each line clears the full owed transfer amount — no
  partial-debt editing on mobile (partial stays a web feature). A **converted** line
  still has an **editable cash amount** (the FX override — what the bank actually
  charged); that is the point of converting, not a partial debt.
- **Convert requires `defaultConversionAccountId`.** If unset, block convert with an
  inline message pointing to the web app (same spirit as the silent payer-default
  account in Epic 2 — but money-movement legs can't be silent).
- Amounts are `numeric(12,2)` **strings** — keep as strings; format for display only.
- 2-member assumption holds (couple). 1-member ⇒ no balances; 3+ ⇒ the per-currency
  card lists all members and renders each pairwise transfer.

---

## Stories

### Story 1 — Per-currency balance cards (view)

Rebuild the interim `BalanceCard` / `balances.tsx` into the design.
`padding 16`, `gap 13`, one card per currency with a non-zero net (sort by
magnitude). Each card = `surface` soft-gloss, radius 16:
- **Header row:** currency code (mono 13/700, ls 1, `ink2`) + currency symbol
  (mono 10.5, `ink3`).
- **Member rows:** 28px `Avatar` + name (15/500) + signed amount, mono 15/700,
  **green `#3f7d5a` if positive, red `#b3492a` if negative**, formatted
  `+1,840.30` / `−1,840.30` — real minus glyph `−`.
- **Divider** (`1px lineSoft`), then **TO SETTLE**: `Label` + sentence
  `{from} owes {to}` (names bold) + a red amount pill (`redBg`, mono 700, radius 6,
  nowrap) reading `{amt} {ccy}`. Derive from/to from the card's `transfers`.
- **All-settled state:** if every currency nets zero, one centered card — 🎉,
  "All settled up" (green 16/700), "nobody owes anybody" (mono 12, `ink3`).
- Footnote: "Balances update live as you add expenses." (mono 11, `ink3`, centered).
  Tab refreshes balances on focus and after an Add (shared state from Epic 2).

**Tests:** signed colors + real-minus formatting from `netPositions`; to-settle
sentence/pill from `transfers`; currencies sorted by magnitude; zero-net currency
hidden; all-settled state; 3-member group lists all transfers without crashing.

### Story 2 — API layer + pure settle helpers

No UI. Lay the typed + testable foundation for Stories 3–4.
- `mobile/lib/api.ts`:
  - extend `GroupSettlement` with `batchId / settledAmount / settledCurrency /
    fxRate` (nullable; backend already returns them).
  - add `BatchSettlementLine` type + `createBatchSettlement(groupId, body)` and
    `confirmBatchSettlement(groupId, batchId, receiverAccountId)`.
  - add `fetchFxRateAsOf(from, to)` → `{ rate, asOfDate } | null`.
  - add `fetchUserSettings()` → `{ preferredCurrency, defaultConversionAccountId, … }`.
- Port `mobile/lib/fish-pie-settle.ts` from `frontend/src/lib/fish-pie-settle.ts`
  (RN-free, near-verbatim): `owedDebts / initLines / isConverted / convertedAmount /
  linesReady / buildBatchLines` + `SettleLine` / `OwedDebt` types.

**Tests (`bun test`, no RN renderer):** helper parity with web — native line mirrors
the debt; converted line carries `fxRate` + target currency; excluded lines dropped;
`linesReady` gates on every included converted line having a positive cash amount;
`owedDebts` flattens only transfers where the current user is the debtor.

### Story 3 — Batch settle-up sheet (create pending)

Replace `SettleModal.tsx` with the batch flow.
- On the Balances tab: a single "Settle up" accent `GlossButton` (height 46) when the
  current user owes anything across any currency; "Waiting for {name} to pay" when
  they're only owed.
- Open a `BottomSheet` (Epic 1) over the pure helpers:
  - **Target currency** selector (reuse `CurrencySheet` from Epic 2), default
    `preferredCurrency`, fallback sticky group currency.
  - One **line per owed debt** (`initLines`): each shows `{to} owes {ccy} {amt}`, an
    **include** toggle (partial *batch* — skip a whole currency), and a
    **Pay {native} / Pay {target}** toggle when the debt currency ≠ target.
  - Converted lines prefill the cash amount from `fetchFxRateAsOf` (editable), with
    the hint `{from} → {target} rate {r} as of {asOfDate}` / "no rate found — enter
    the amount you paid".
  - One **payer account** (`AccountPicker`), **date** (`DateSheet` from Epic 2,
    default today), optional **note**.
- Submit → `buildBatchLines` → `createBatchSettlement`. The batch is **pending**:
  reflect it on the card ("Recorded — awaiting {receiver}" badge / disabled settle
  button); balance does **not** zero until confirm.
- Convert with no `defaultConversionAccountId` ⇒ inline guard, no silent failure.

**Tests:** payload built from helpers (native == old single behavior; converted
carries fxRate + target); excluded lines omitted; target defaults to preferred
currency; pending state reflected; convert-without-conversion-account guarded;
payer account required before submit.

### Story 4 — Receiver confirm (batch-aware)

The receiver completes a pending batch.
- Surface pending batches where the **current user is the receiver** (identify via
  `getEmail()` matched to `group.members[].userEmail`, same as `ExpenseForm`) — a
  banner on the Balances card and/or a row in History (Epic 4 owns the list; this
  epic only needs it queryable + confirmable).
- Confirm picks a `receiverAccountId` (default the receiver's group default; allow
  change) → `confirmBatchSettlement(groupId, batchId, receiverAccountId)`. On success
  every row flips to `completed`; balances update on refresh.
- The **payer** sees no Confirm for their own outgoing batch.

**Tests:** only the receiver sees Confirm; confirm books with the chosen account and
flips all rows to completed; balances reflect completion after refresh; payer does
not see Confirm for their own batch; confirming an already-completed batch surfaces
the backend 409.

---

## Out of scope

- Editing settlements beyond create / confirm / delete (`deleteSettlement` exists;
  expose only if the design calls for it — it does not).
- Partial-debt amounts on mobile (full owed amount per line; partial via web).
- Arbitrary per-line target currency — the sheet defaults the target to the home
  (preferred) currency for all converted lines.
- Auto-refreshing FX rates after the sheet opens (fetch once on open / on toggle).
- The History list rendering of settlements — Epic 4.

## Notes

- The web helper `fish-pie-settle.ts` is already DOM-free; keep the mobile port a
  near-verbatim copy so the two stay in sync and the tests mirror.
- `equity:conversions` bridging is entirely backend — mobile never constructs
  postings, only the line payload.
