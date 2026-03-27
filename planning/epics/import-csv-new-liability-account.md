# Epic: Import CSV for New Liability Account

Goal: Make it possible to import transactions for a liability account (e.g. a credit card) correctly — including creating the account if it doesn't exist yet — and fix the sign inversion bug that makes liability imports produce wrong ledger entries.

## Background

Liability accounts have inverted sign semantics versus asset accounts. When a credit card CSV shows a charge as a positive number, the correct ledger entry is a **negative** posting to the liability account (the debt increases) and a **positive** posting to the expense account. The current importer posts amounts as-is, which produces the wrong result for liabilities.

This epic also covers the UX for adding a new liability account on the import page (using the AddAccountWizard), so a user can go from a fresh credit card CSV to a fully imported statement without touching the assets/settings pages.

See also: **BUG-002** in BUGS.md.

---

## Decision: how to handle sign inversion

Two options were considered:

**Option A — Parser-level "negate amounts" flag**
- An explicit boolean on the parser the user sets when configuring a liability parser
- Flexible: works if a bank exports liability charges as negative (some do)
- Downside: adds a config field the user must remember to set; easy to forget

**Option B — Auto-negate based on account type at import time**
- At commit time, check if the target account's path starts with `defaultLiabilitiesRootPath`
- If yes, negate all amounts before posting
- No extra config needed; the account path carries the intent
- Downside: breaks if a liability account uses positive-for-charges convention for a different reason

**Leaning toward Option B** as the default with Option A as an override if edge cases surface. Confirm before implementing.

---

## Stories

### 1. Decide and document the sign inversion strategy

- Review the two options above with the user
- Update this epic with the chosen approach and close BUG-002

### 2. Add "New liability account" button to the import page

- Sits above or alongside the existing form, outside the import panel
- Uses the existing `AddAccountWizard` component with `type="liability"`
- On success, refreshes the accounts list so the new account is immediately selectable in the form

### 3. Implement sign inversion for liability imports

- Implement the chosen strategy (likely auto-negate on backend at commit time)
- If Option B: in the import commit handler, look up the account's path, compare against `defaultLiabilitiesRootPath`, and negate amounts for non-transfer rows
- Write a test covering: positive CSV amount → negative liability posting + positive expense posting

### 4. Surface liability accounts in the "to account" selector

- The import form currently seeds `toAccountId` from `defaultOffsetAccountId` (an asset account)
- A liability import needs to select a liability account as the source
- Consider whether the selector should be unrestricted (any account) or filtered by root path
- No UI change may be needed — the existing AccountPathInput already accepts any path

