# Epic: Add Import Parser

Goal: A modal wizard on the Import page that lets the user create a new CSV parser for an existing account — without leaving the page. Reuses the parser setup steps from `AddAccountWizard`, replacing the account-creation step with an account-picker step.

## Background

Currently, adding a parser requires navigating to Settings, filling in a form, and then returning to Import. This epic adds an "Add parser" button to the Available Parsers panel on the Import page that opens a focused wizard. The wizard borrows the multi-step parser setup flow from `AddAccountWizard` — only step 1 changes.

---

## Stories

### 1. Wizard shell — `AddParserWizard.svelte`

Frontend / new `AddParserWizard.svelte` component.

- New component in `frontend/src/lib/components/`
- Multi-step modal, title: "Add Import Parser"
- Steps: ACCOUNT_PICK → PARSER_UPLOAD → PARSER_COLUMNS → PARSER_MULTICURRENCY → CONFIRM
- Same step/nav pattern as `AddAccountWizard` — transition tables for `NEXT` and `BACK`, `next()` / `back()` / `skip()` / `close()` functions
- Footer with Back / Next / Skip / Confirm buttons, identical logic to `AddAccountWizard`
- Props: `open: boolean`, `accounts: Account[]`, `onSuccess?: (parser: CsvParser) => void`
- Step content is placeholder for now; the shell just renders the correct footer buttons per step

### 2. Step 1 — Account picker

Frontend / `AddParserWizard.svelte`, step 1 (ACCOUNT_PICK).

- Replaces the account-creation step from `AddAccountWizard` entirely
- `AccountPathInput` component bound to `selectedAccountId` (string state, ID of chosen account)
- No account creation, no starting balance — pick from existing accounts only
- Next is disabled until `selectedAccountId` is non-empty
- The account picker step has no Skip — the user must choose an account

### 3. Steps 2–4 — Parser setup

Frontend / `AddParserWizard.svelte`, steps 2–4.

- PARSER_UPLOAD: parser name input, CSV file upload, detected header display, multi-currency toggle — identical to `AddAccountWizard` step 2
- PARSER_COLUMNS: column mapping dropdowns (date, amount, description, currency, direction column + negative value) — identical to `AddAccountWizard` PARSER_COLUMNS step
- PARSER_MULTICURRENCY: source/target/fee column mapping (conditional on `isMultiCurrency`) — identical to `AddAccountWizard` PARSER_MULTICURRENCY step
- Copy the state variables, `handleFileUpload`, `normalizeColumn`, `buildNormalizedHeader`, and `resetStep2` from `AddAccountWizard` — no changes to the logic

### 4. Step 5 — Confirm + wire up import page

Frontend / `AddParserWizard.svelte` step 5 + `import/+page.svelte`.

- Confirm step: read-only summary showing the selected account path and all parser details (same layout as the CSV Parser section of `AddAccountWizard`'s confirm step)
- Confirm button POSTs to `/api/parsers` with `defaultAccountId` set to `selectedAccountId` — no account or transaction creation
- On success: calls `onSuccess(newParser)`, closes the modal
- On error: shows `submitError` in the confirm step

Wire up on the Import page:
- Add `showAddParser = $state(false)` to the page
- Add an "Add parser" button inside the Available Parsers panel body, above the `TableShell` 
- Render `<AddParserWizard bind:open={showAddParser} {accounts} onSuccess={(p) => { parsers = [...parsers, p]; }} />`
