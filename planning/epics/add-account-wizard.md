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

- Wraps `<Modal title="Add new asset">` (title can update per step if needed)
- Internal step state: step 1 → step 2 → step 3
- Footer with Back / Next / Skip / Confirm buttons that change depending on the current step
- Step 2 is skippable — Skip jumps straight to the confirmation step
- Wires up to the existing "Add new asset" button on the Assets page (replace the placeholder modal)

### 3. Step 1 — Account path and starting balance

Frontend / `AddAccountWizard.svelte`, step 1.

- Type hint buttons: "Asset" / "Liability" / "Equity" — clicking one prefills `AccountPathInput` with `assets:` / `liabilities:` / `equity:` respectively (using `defaultAssetsRootPath` and `defaultLiabilitiesRootPath` from user settings for the first two)
- Label: "Or just start typing:" with the `AccountPathInput` below
- Optional "Starting balance" amount + currency input below the path input
- Next is disabled until the account path is non-empty

### 4. Step 2 — Parser setup (skippable)

Frontend / `AddAccountWizard.svelte`, step 2.

- Heading: "Set up a CSV parser" with a Skip button in the footer
- File upload button — reads the uploaded file and extracts the first non-empty line as the header row
- Displays the detected header for confirmation
- Multi-currency checkbox with tooltip hint (same as the existing parser form)
- Column mapping dropdowns — one per required/optional field (date, amount, description, currency; plus multi-currency fields if checked)
- Reuses the same normalization logic as the Settings parser form

### 5. Step 3 — Confirmation

Frontend / `AddAccountWizard.svelte`, step 3.

- Read-only summary: account path, starting balance (if provided), parser name + column mappings (if configured), or "No parser" if step 2 was skipped
- "Parser name" input — required only if a parser was configured in step 2
- Confirm button submits: creates the account, posts the starting balance transaction (if any), creates the parser (if any)
- On success: closes the modal, refreshes the account list on the page

### 6. Add wizard to the Import page

Frontend / Import page.

- Add an "Add new asset" button to the top of the Import page, same as on the Assets page
- Both trigger the same `AddAccountWizard` component
