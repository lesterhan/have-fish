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

#### 004a — Settlement postings have inverted signs

**Debtor's group:** is always `+split.amount` (positive) from their member tx.  
**Creditor's group:** with the 004b fix in place = `+others_share` (positive) for chequing/liability-flag CC.

After the fix, **both debtor and creditor have a positive `group:` balance**. To clear a positive balance, you post a negative amount.

Current settlement code (`fish-pie-settlements.ts`):
- Payer (debtor) tx, line 113: posts `+amount` → balance goes **up** ✗ (should be `−amount`)
- Receiver (creditor) confirm tx, line 179: posts `−amount` → balance also goes **down** ✗ (should be `−amount` for chequing/liability-flag too, but sign of current code happens to be wrong for all cases)

**Concrete example**, chequing $10 after 004b fix, 50/50:
- Debtor group: = +5, creditor group: = +5
- Settlement $5: debtor should go +5 → 0, creditor should go +5 → 0
- Fix: both payer tx and receiver tx post `−amount` to `group:`

**Important caveat — raw CC without liability flag:**  
For `t.amount > 0` (no liability flag), `negated < 0`, creditor `group:` ends up negative (e.g., −5). To clear a negative balance you need `+amount`. So the settlement receiver direction depends on the sign of the original import's `negated`. Since the user always uses the liability flag, the `−amount` fix covers all real-world usage. The raw CC case can be noted and left for later or handled via convention documentation.

---

#### Fix plan — do in this order

**Step 1: Refactor posting creation into one place**

Create `backend/src/import/postings.ts`. Move all import-transaction posting logic here. This makes the fix in step 2 legible.

```typescript
// postings.ts
export type PostingSpec = {
  accountId: string
  amount: string
  currency: string
}

// Builds the postings for a regular (non-Fish-Pie) import transaction.
export function buildRegularPostings(opts: {
  transactionId: string
  sourceAccountId: string
  amount: string          // t.amount, already sign-adjusted by frontend
  offsetAccountId: string
  currency: string
}): PostingSpec[]

// Builds the postings for a Fish Pie import transaction (3 postings).
// Also returns the payer's expense amount so the caller can skip the
// payer member tx in createGroupExpenseInTx.
export function buildFishPiePostings(opts: {
  transactionId: string
  sourceAccountId: string
  amount: string          // t.amount, already sign-adjusted
  groupAccountId: string  // group:<slug>
  expenseAccountId: string
  payerShareRatio: number // e.g. 0.5 for 50%
  currency: string
}): PostingSpec[]
```

The 3-posting Fish Pie structure — splits `negated` proportionally between `group:` (others' share) and `expenses:` (payer's share). They always sum to zero with the source:

```
source:   t.amount                           (e.g. −10 for chequing)
group::   negated × others_share_ratio       (e.g. +5 for 50/50)
expense:  negated × payer_share_ratio        (e.g. +5 for 50/50)
```

Sum: `t.amount + negated × 1 = t.amount + (−t.amount) = 0` ✓

**Step 2: Wire up the 3-posting import tx**

In `import.ts`, when `groupSplit` is set:
1. Compute `payerShareRatio` from the group member weights
2. Call `buildFishPiePostings` with the payer's `expenseAccountId` (from `member.defaultExpenseAccountId` or `ensureUncategorizedAccount`) and `groupAccountId` (from `ensureSharedAccount`)
3. Pass a flag/option to `createGroupExpenseInTx` telling it to **skip the payer member tx** (since the import tx already covers it)

In `fish-pie-expense-service.ts`, add an optional `skipPayerMemberTx: boolean` param to `createGroupExpenseInTx`. When true, skip creating the member tx for the payer (still create splits in `groupExpenseSplits`, still create non-payer member txs).

**Step 3: Fix settlement signs**

Current code in `fish-pie-settlements.ts`:
- Payer (debtor) tx, line 113: posts `+amount` to group: — **wrong**, increases balance
- Receiver (creditor) confirm tx, line 179: posts `−amount` to group: — **correct** for chequing/liability-flag

With the 004b fix, creditor group: is +5 and debtor group: is +5. To clear both toward zero, both need `−amount`.

```
Payer (debtor):   group: +5 → post −5 → 0  ✓
Receiver (creditor): group: +5 → post −5 → 0  ✓
```

Receiver tx already posts `−amount`, so only **one line needs changing**: line 113 from `amount` to `\`-${amount}\``.

**Files to change:**
- `backend/src/import/postings.ts` — new file
- `backend/src/routes/import.ts` — use postings.ts, compute payerShareRatio, pass skipPayerMemberTx
- `backend/src/fish-pie-expense-service.ts` — add skipPayerMemberTx param, skip payer member tx when set
- `backend/src/routes/fish-pie-settlements.ts:113` — change `amount` to `-${amount}` for payer group: posting
- Tests for all of the above

**Test the fix with:**
- Chequing $10, 50/50: group: = +5 for both, settlement clears both to 0
- Liability-flag CC $10, 50/50: same as chequing (identical t.amount path)
- Expense-only (no import): member txs unchanged, settlement unchanged

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
