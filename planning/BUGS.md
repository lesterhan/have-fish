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

## CSV Import

### BUG-002 — Liability account imports have inverted signs

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
