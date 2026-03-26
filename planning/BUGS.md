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
