# Epic: Add Account Wizard

Goal: A modal wizard that walks the user through creating a new account and optionally setting up a CSV parser for it — all without leaving the current page. The result is an account that is immediately usable for imports.

## Background

Currently accounts are created on the Settings page and parsers are configured separately. A new user has to jump between pages and manually wire things together. The wizard collapses this into a single guided flow triggered from wherever the user already is (Assets page, Import page).

---

## Stories

### 1. Backend — add defaultLiabilitiesRootPath user setting

Backend / user settings.

- Add `defaultLiabilitiesRootPath` column to user settings schema (plaintext, default `"liabilities"`)
- Expose it in `GET /api/user-settings` and `PATCH /api/user-settings`
- Follows the same pattern as the existing `defaultAssetsRootPath`

### 2. Wizard shell — multi-step modal

Frontend / new `AddAccountWizard.svelte` component.

- Accepts a `type: 'asset' | 'liability'` prop — controls the modal title ("Add New Asset Account" / "Add New Liability Account") and the path prefix pre-filled in step 1
- Internal step state: step 1 → step 2 → step 3
- Footer with Back / Next / Skip / Confirm buttons that change depending on the current step
- Step 2 is skippable — Skip jumps straight to the confirmation step
- Wires up to both buttons on the Assets page ("New asset account" / "New liability account"), passing the appropriate `type`
- The `showAddLiability` state on the Assets page is currently declared but not yet rendered — wire up the missing liability button as part of this story

### 3. Step 1 — Account path and starting balance

Frontend / `AddAccountWizard.svelte`, step 1.

- `AccountPathInput` pre-filled with `defaultAssetsRootPath + ":"` or `defaultLiabilitiesRootPath + ":"` depending on `type` (fetched from user settings)
- Optional "Starting balance" amount + currency input
- Optional "Starting balance date" picker, pre-selected to today
- Next is disabled until the account path is non-empty

### 4. Step 2 — Parser setup (skippable)

Frontend / `AddAccountWizard.svelte`, step 2.

- Heading: "Set up a CSV parser" with a Skip button in the footer
- Parser name input at the top of this step (not the confirmation page)
- File upload button — reads the uploaded file and extracts the first non-empty line as the header row
- Displays the detected header for confirmation
- Multi-currency toggle (new component) with tooltip hint
- Column mapping dropdowns — one per required/optional field (date, amount, description, currency; plus multi-currency fields if toggled on)
- Reuses the same normalization logic as the Settings parser form
- Next is disabled until parser name is filled and required columns (date, amount) are mapped

### 5. Step 3 — Confirmation

Frontend / `AddAccountWizard.svelte`, step 3.

- Read-only summary: account path, starting balance + date (if provided), parser name + column mappings (if configured), or "No parser" if step 2 was skipped
- Confirm button submits:
  - Creates the account
  - If a starting balance was entered: POSTs a transaction using `defaultOffsetAccountId` from user settings as the offset account (same pattern as the existing starting-balances flow — do not ask the user to pick an offset account)
  - Creates the parser (if configured in step 2)
- On success: closes the modal, refreshes the account list on the page

