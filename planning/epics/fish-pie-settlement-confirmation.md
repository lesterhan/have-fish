# Epic: Fish Pie — Settlement Confirmation Flow

**Goal:** Replace the current single-sided settlement record with a two-sided confirmation flow where both parties log the cash movement, creating real transactions in their personal ledger accounts.

---

## Background

Currently a settlement is recorded by one person as a single `groupSettlements` row. There is no confirmation by the recipient, and no transaction is created in either party's accounts. This epic replaces that with:

1. **Initiator proposes** — the payer creates a pending settlement and picks the account they paid from.
2. **Receiver confirms** — the recipient sees a pending settlement in the group panel, picks the account they received into, and confirms.
3. **Both sides get real transactions** — on confirmation, two transactions are created: one for the payer (money out), one for the receiver (money in).

The `shared:<group>` account (created in Account Integration) is the balancing leg for both — it is how settlement clears the group balance on each person's ledger.

**Payer example** (Lester owes partner $100, settles via chequing):
- Payer transaction: `shared:<group>` −$100 (debt cleared) / `assets:chequing` −$100

Wait — that doesn't balance. Correct double-entry for payer:
- Debit `shared:<group>` $100 (reduces the liability — partner no longer owed)
- Credit `assets:chequing` $100 (cash left the account)

Receiver:
- Debit `assets:chequing` $100 (cash arrived)
- Credit `shared:<group>` $100 (reduces the receivable)

**Duplicate detection:** when the payer later imports their bank CSV, the settlement outflow will appear. The existing duplicate resolution system should flag it. To support this, the payer's settlement transaction is tagged on the `groupSettlements` row — import deduplication can check for an existing transaction with the same amount/date and surface a match.

---

## Schema changes

### `groupSettlements` — two-sided status + transaction links

```
status                   text      not null  default 'pending'
                                             -- 'pending' | 'completed'
payerTransactionId       uuid      nullable → transactions.id
receiverTransactionId    uuid      nullable → transactions.id
proposedAt               timestamp not null  defaultNow()  -- rename from createdAt or add alongside
```

Migration: add `status`, `payerTransactionId`, `receiverTransactionId`. All existing rows → `status = 'completed'` (they were already recorded as done).

---

## Stories

### 1. Schema migration (backend)

- Add `status`, `payerTransactionId`, `receiverTransactionId` to `groupSettlements`.
- Update `POST /api/fish-pie/groups/:id/settlements`:
  - Accept `payerAccountId` in body.
  - Create the settlement row with `status = 'pending'`.
  - Create payer's transaction immediately: debit `shared:<group>`, credit `payerAccountId` for settlement amount. Store as `payerTransactionId`.
  - Do NOT yet clear the balance — pending settlements do not affect balance computation until confirmed.
- Update balance computation to exclude `status = 'pending'` settlements (or keep as-is if balance query already handles this).

Tests:
- `POST` with `payerAccountId` creates settlement + payer transaction.
- Pending settlement excluded from balance until confirmed.

### 2. Receiver confirmation API (backend)

`POST /api/fish-pie/groups/:id/settlements/:settlementId/confirm`
- Calling user must be `toUserId` (the receiver).
- Settlement must be `status = 'pending'`.
- Body: `{ receiverAccountId }`.
- Creates receiver's transaction: debit `receiverAccountId`, credit `shared:<group>` for settlement amount. Store as `receiverTransactionId`.
- Sets `status = 'completed'`.
- Balance computation now includes this settlement.

Tests:
- Non-receiver cannot confirm (403).
- Double-confirm is a no-op / 409.
- After confirm: balance updated, both transactions exist.

### 3. Pending settlement UI (frontend)

In the group detail page's right settlement panel:

**For the receiver:**
- Pending settlements appear at the top of the panel with a yellow/amber indicator.
- "Confirm receipt" button → opens a small inline form: account picker (the account they received into) + confirm button.
- On confirm: calls the confirmation endpoint, panel refreshes.

**For the initiator (payer):**
- Pending settlements show as "Awaiting confirmation" with a muted indicator.
- No action available — they already recorded their side.

**General:**
- Completed settlements show as before.
- Settlement history list includes status badge.

### 4. Settlement proposal UI update (frontend)

Update the existing "Record settlement" form:

- Add "Paid from account" picker (account selector, filtered to assets/liabilities — where actual money moves).
- This is now required for submission (creates payer transaction immediately).
- Label changes: "Record settlement" → "Propose settlement".

### 5. Duplicate detection hint (frontend — import flow)

In the CSV import review step, when a pending or completed settlement transaction is matched by the duplicate resolver:

- Show a note: "This may be a Fish Pie settlement you already recorded."
- Link to the relevant group.
- User can skip or merge as normal — no forced behaviour.

This is a UI hint only. The matching logic uses the existing duplicate detection (same amount + date + approximate description). No new backend logic required.
