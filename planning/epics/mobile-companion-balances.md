# Epic: Pocket Companion — Balances & Settlement (Companion 3 of 4)

**Goal:** Rebuild the Balances tab to the design: one soft-gloss card **per
currency** showing each member's signed net, a "to settle" sentence, and a record-
settlement action. Balances render straight from `fetchBalances` (no client-side
math). Settlement keeps the backend's **two-step pending → confirm** model on
mobile (decision locked) rather than the prototype's one-tap instant-complete.

Builds on Epic 1 (theme, gloss primitives, bottom-sheet, shell).

## Design reference

- **Screenshot:** `.design/balances-tab.png`
- **Handoff:** `.design/handoff/README.md` — section *Screen: Balances* (note the
  balance-math block there is **illustrative**; the backend already computes it).
- **Prototype:** `.design/handoff/companion/screens-more.jsx` (Balances).

## Backend reconciliation (decisions locked)

- **Do not recompute balances on the client.** `fetchBalances(groupId)` returns
  `CurrencyBalance[]` with `netPositions` (`{userId, userName, amount}` per member)
  and `transfers` (`{fromUserId, toUserId, amount, currency}`) per currency. Render
  these directly. The handoff's `balancesByCcy()` and the 40/60 split math are just
  to explain the model — ignore them as code.
- **Settlement is two-step, not one-tap.** The prototype "Record settlement" appends
  a `COMPLETED` settlement instantly. The real backend:
  - `createSettlement` → creates a **pending** settlement; requires
    `{ fromUserId, toUserId, amount, currency, date, payerAccountId }`.
  - `confirmSettlement(groupId, settlementId, receiverAccountId)` → receiver books
    the receiving leg, flips to `completed`.
  So mobile records a **pending** settlement, and the **receiver** confirms it. This
  is a deliberate deviation from the prototype's single COMPLETED tap.
- Amounts are `numeric(12,2)` **strings** — keep them as strings; format for display
  only.
- 2-member assumption holds (couple). For a 1-member group there are no balances;
  for 3+ the per-currency card lists all members and renders each pairwise transfer
  in the "to settle" block rather than a single sentence.

---

## Stories

### Story 1 — Per-currency balance cards (view)

`padding 16`, `gap 13`, one card per currency with a non-zero net (sort by
magnitude). Each card = `surface` soft-gloss, radius 16:
- **Header row:** currency code (mono 13/700, ls 1, `ink2`) + currency symbol
  (mono 10.5, `ink3`).
- **Member rows:** 28px `Avatar` + name (15/500) + signed amount, mono 15/700,
  **green `#3f7d5a` if positive, red `#b3492a` if negative**, formatted
  `+1,840.30` / `−1,840.30` — use the real minus glyph `−`.
- **Divider** (`1px lineSoft`), then **TO SETTLE**: `Label` + sentence
  `{from} owes {to}` (names bold) + a red amount pill (`redBg` bg, mono 700, radius
  6, nowrap) reading `{amt} {ccy}`. Derive from/to from the card's `transfers`.
- **All-settled state:** if every currency nets zero, a single centered card — 🎉,
  "All settled up" (green 16/700), "nobody owes anybody" (mono 12, `ink3`).
- Footnote under the cards: "Balances update live as you add expenses." (mono 11,
  `ink3`, centered). The tab should refresh balances on focus and after an Add
  (shared state from Epic 2) so this holds true.

**Tests:** card renders signed colors + real-minus formatting from `netPositions`;
to-settle sentence/pill from `transfers`; currencies sorted by magnitude; zero-net
currency hidden; all-settled state shown when everything nets zero; 3-member group
lists all transfers without crashing.

### Story 2 — Record settlement (create pending)

The "Record settlement" accent `GlossButton` (height 46) on each currency card opens
the settlement flow:
- Prefill `fromUserId`/`toUserId`/`amount`/`currency` from the card's transfer
  (debtor pays creditor the full owed amount; allow editing the amount for partial
  settlements if cheap, otherwise full-amount only — note which).
- `payerAccountId`: the payer's account the money leaves from. Default to the payer's
  `defaultPaymentAccountId`; if unset, require a pick (small account list) — the
  money-movement leg can't be silent the way an expense can, but keep it minimal.
- `date`: default today.
- On submit → `createSettlement`. The settlement is now **pending**; reflect that on
  the card (e.g. a "pending settlement" badge / disabled record button) and in
  History (Epic 4). Do **not** zero the balance until it's confirmed — the backend
  balance won't change until completion.

**Tests:** create writes the correct `from/to/amount/currency/payerAccount`; pending
state reflected; balance unchanged until confirm; missing payer account prompts a
pick rather than failing silently.

### Story 3 — Confirm settlement (receiver side)

The receiver confirms a pending settlement to complete it:
- Surface pending settlements where the **current user is the receiver** (a banner on
  the Balances card and/or a row action in History) with a Confirm action.
- Confirm picks the `receiverAccountId` (default the receiver's group default; allow
  change) → `confirmSettlement(groupId, settlementId, receiverAccountId)`. On success
  the settlement is `completed` and balances update on refresh.
- Identify the current user via `getEmail()` matched to `group.members[].userEmail`
  (same pattern as the current `ExpenseForm`).

**Tests:** only the receiver sees Confirm; confirm books with the chosen account and
flips status to completed; balances reflect the completion after refresh; the payer
does not see a Confirm action for their own outgoing settlement.

---

## Out of scope

- Deleting/editing settlements beyond what `lib/api.ts` already exposes
  (`deleteSettlement` exists; expose only if the design calls for it — it does not).
- Cross-currency conversion — currencies settle independently (core invariant).
- The History list rendering of settlements (Epic 4) — this epic only needs the
  pending/confirm state to be queryable.

## Notes

- The prototype shows an instant COMPLETED settlement; we intentionally show
  **pending** until the receiver confirms. Keep the design's *visual* card/button
  treatment, but the copy must not claim "settled" before confirmation — use
  "Recorded — awaiting {receiver}" or similar for the pending interim.
</content>
