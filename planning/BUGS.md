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

Two related issues that stem from the same root: the `group:<slug>` account ends up with the wrong value, making the ledger inaccurate even though the balance screen (which recomputes from first principles) stays correct.

#### 004a — Settlement postings have inverted signs

**Steps to reproduce:**
1. Credit card import $100, Fish Pie group 50/50 → creditor's `group:housing` = −50 (group owes them $50)
2. Debtor initiates a $30 settlement
3. Creditor confirms

**Expected after $30 settlement:**
- Debtor `group:housing`: +50 → +20 (still owes $20)
- Creditor `group:housing`: −50 → −20 (still owed $20)

**Actual:**
- Debtor `group:housing`: +50 → +80 (settlement adds +30, should subtract)
- Creditor `group:housing`: −50 → −80 (confirmation subtracts −30, should add)

**Root cause:** `fish-pie-settlements.ts`  
- Payer tx (line 113): posts `+amount` to `group:`. Should be `−amount` to reduce the debtor's positive balance.  
- Receiver confirm tx (line 179): posts `−amount` to `group:`. Should be `+amount` to reduce the creditor's negative balance.

#### 004b — Asset-source (chequing) imports compound `group:` balance incorrectly

**Steps to reproduce:**
1. Import a $1200 chequing expense (CSV amount is negative), Fish Pie group 50/50
2. Inspect payer's `group:housing`

**Expected:** `group:housing` = −600 (group owes payer $600, same semantic as credit card case)

**Actual:** `group:housing` = +1800
- Import tx posts `negated = +1200` (chequing negative amount is negated to positive)
- Payer member tx posts another `+600`
- Total: +1800 — wrong direction and wrong magnitude

**Root cause:** For asset-source imports, `t.amount` is negative and `negated` is positive. This is correct for the source account posting but results in the wrong sign for `group:housing`. Credit card imports work correctly because their positive `t.amount` produces a negative `negated` for `group:housing`.

**Fix direction:**
For Fish Pie import rows, the `group:` posting amount should be derived from the absolute value and always be negative for the paying side: use `−abs(t.amount)` and adjust the source posting correspondingly. This requires the import tx for asset-source Fish Pie rows to use a 3-posting structure:

```
# chequing $1200 rent, 50/50 split, payer's share = $600
chequing              −1200    (cash out)
group:housing         −600     (group owes payer others' share)
expenses:rent         +600     (payer's own expense share)
```

This eliminates the payer's member transaction entirely for import-linked expenses (the import tx already captures both the payment and the expense distribution). Non-payer member transactions are unchanged.

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
