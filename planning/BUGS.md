# Bugs

## Add Account Wizard

### BUG-001 — Skipping parser then going back does not save parser on confirm

**Steps to reproduce:**
1. Open the Add Account wizard
2. On the `parser-upload` step, click Skip
3. On the `confirm` step, click Back
4. Fill in the parser name, upload a CSV, map columns
5. Click Next through to confirm and submit

**Expected:** Parser is created.

**Actual:** `parserSkipped` is still `true` (it was set on skip and never cleared when the user navigated back). The confirmation step shows "No parser configured" and the submit logic skips parser creation.

**Fix direction:** Clear `parserSkipped` when the user navigates back from `confirm` into a parser step.

## Fish Pie

### BUG-003 — Deleting import-linked Fish Pie expense leaves orphaned import transaction

**Branch:** `fix/fish-pie-delete-orphaned-import-tx`

**Steps to reproduce:**
1. Import a CSV row and assign it to a Fish Pie group
2. Go to the Fish Pie group and delete that expense

**Expected:** Import transaction and all related postings are soft-deleted. `group:<slug>` account returns to zero.

**Actual:** The member transactions (those with `groupExpenseId` set) are soft-deleted correctly. But the import transaction (`groupExpenses.transactionId`) is not touched — it was created without a `groupExpenseId` link, so the delete query misses it. After deletion, the import tx's posting to `group:<slug>` has no counterpart and the account carries an uncancelled balance.

**Root cause:** `fish-pie-expenses.ts` DELETE handler queries `WHERE transactions.groupExpenseId = expenseId`. The import transaction links in the opposite direction (`groupExpenses.transactionId = importTxId`) and is not found.

**Fix direction:**
After soft-deleting the member transactions, check `expense.transactionId`. If set, also soft-delete that import transaction and its postings within the same DB transaction.

---

### BUG-004 — Fish Pie `group:` account balance incorrect for settlements and asset-source imports

**Branch:** `fix/fish-pie-group-account-balance`

Two related issues. The balance screen (`fish-pie-balances.ts`) is unaffected — it recomputes from first principles and is always correct. The ledger postings are wrong.

---

#### Sign convention primer (read first)

The **frontend** flips the CSV amount for liability imports (`import/+page.svelte:250-252`):

```javascript
const amount = importAsLiabilities ? String(-parseFloat(tx.amount)) : tx.amount
```

This means the backend always receives `t.amount < 0` for both chequing (already negative) and credit-card-with-liability-flag (flipped from positive). **Both cases are identical at the backend.** The only case where the backend receives `t.amount > 0` is a raw credit card import WITHOUT the liability flag.

The backend then computes:
```typescript
const negated = (-parseFloat(t.amount)).toFixed(2)
// source gets t.amount, offset gets negated
```

So `negated` is always the opposite sign of `t.amount`. For the current user's workflow (liability flag always enabled + chequing), `t.amount < 0` and `negated > 0` universally.

The `group:` account sign that naturally falls out:
- `t.amount < 0` → `negated > 0` → group: posting is **positive** (chequing / liability-flag CC)
- `t.amount > 0` → `negated < 0` → group: posting is **negative** (raw CC, no flag) ← only this case currently works

---

#### 004b — Import-linked Fish Pie creates wrong `group:` balance

**Affected cases:** chequing imports AND credit card imports with the liability flag (i.e. all current real-world usage).

**Current flow** (2-posting import + payer member tx), chequing $10, 50/50:

```
Import tx:         chequing  −10,  group:food  +10
Payer member tx:   expenses   −5,  group:food   +5
                                   ──────────────
Net group:food:                        +15   ← meaningless
```

The import tx and payer member tx both post in the **same direction** to `group:food` — they compound instead of partially cancelling.

**Expected:** `group:food = +5` (in chequing convention, positive = group owes payer $5).

**Root of root cause:** The current design assumed the import tx offset goes to the expense account (which partially cancelled with the member tx). PR #23 redirected the offset to `group:`, which was correct for raw CC but broke chequing/liability-flag by removing the cancellation.

---

#### 004a — Payer group: account does not clear after settlement ⚠ Deferred

**Debtor's group:** is always `+split.amount` (positive) from their member tx.  
**Creditor's group:** with the 004b fix in place = `+others_share` (positive) for chequing/liability-flag CC.

Current settlement code (`fish-pie-settlements.ts`):
- Receiver (creditor) confirm tx: posts `−amount` to group: → **correctly clears** creditor's +balance to 0 ✓
- Payer (debtor) tx: posts `+amount` to group: → balance goes **up** (accumulates, never clears) ✗

**Why the obvious fix doesn't work:**

Changing line 113 from `amount` to `\`-${amount}\`` would post `−5` to group: for the payer. But the payer tx already posts `−amount` to the chequing account. Two negative postings sum to `−2×amount`, not 0 — the transaction would be unbalanced. This would break the existing settlement test.

**Root cause:** The expense member tx for all members (including debtors) posts `+split.amount` to group:. This is required for the 2-posting member tx to balance (`expenses: -5, group: +5 = 0`). For the RECEIVER's settlement tx, this works perfectly: receiver gets `+cash`, posts `-amount` to group: → balanced, cleared. For the PAYER's settlement tx, balancing requires `+amount` to group:, which increases rather than clears.

**Why it's deferred:** The group: account is purely cosmetic — the balance screen recomputes from first principles and is unaffected. Fixing payer clearing without breaking balance requires either a 3-posting payer tx (needs a third account) or redesigning how debtor member txs post. Scope is larger than 004b.

---

#### Fix plan for 004b (implemented) ✓

**Step 1: Refactor posting creation into one place** ✓ (PR #25)

`backend/src/import/postings.ts` with `buildRegularPostings` and `buildFishPiePostings`.

**Step 2: Wire up the 3-posting import tx** ✓ (PR #26)

3-posting structure — splits `negated` proportionally between `group:` (others' share) and `expenses:` (payer's share). Sum always zero:

```
source:   t.amount                        (e.g. −10 for chequing)
group::   negated × others_share_ratio    (e.g. +5 for 50/50)
expense:  negated × payer_share_ratio     (e.g. +5 for 50/50)
```

`createGroupExpenseInTx` skips the payer member tx (`skipPayerMemberTx: true`) since the import tx already records their share.

**Files changed:**
- `backend/src/import/postings.ts` — `buildFishPiePostings` wired
- `backend/src/routes/import.ts` — 3-posting Fish Pie branch, payerShareRatio computed from member weights
- `backend/src/fish-pie-expense-service.ts` — `skipPayerMemberTx` param added

**Verified by tests:**
- Import tx has exactly 3 balanced postings
- group: posting = others' share only (not full negated amount)
- No payer member tx created for import-linked expenses

---

## CSV Import

### BUG-002 — Liability account imports have inverted signs ✓ Fixed

**Steps to reproduce:**
1. Import a credit card CSV where charges are positive amounts
2. The parser's default account is a liability (e.g. `liabilities:visa`)

**Expected:**
```
liabilities:visa   -50.00 CAD   (liability increases — you owe more)
expenses:food      +50.00 CAD   (expense increases)
```

**Actual:**
```
liabilities:visa   +50.00 CAD   (reads as liability decreasing — a payment)
expenses:food      -50.00 CAD   (reads as expense decreasing — makes no sense)
```

**Root cause:** The import posts CSV amounts as-is to the account. This is correct for assets (positive = deposit) but wrong for liabilities (positive CSV amount = charge = liability increases = should be negative posting).

**Options under consideration:**
- **Parser-level "negate amounts" flag** — explicit toggle on the parser, user sets it when the account is a liability. Flexible, works for edge cases where a liability CSV uses negative amounts.
- **Auto-negate based on account type** — at import time, check if the target account path starts with `defaultLiabilitiesRootPath` and negate automatically. No extra config needed.
