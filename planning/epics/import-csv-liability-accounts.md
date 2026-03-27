# Epic: Import CSV for Liability Accounts

Goal: Make it possible to import transactions for a liability account (e.g. a credit card) correctly, fixing the sign inversion bug so that charges produce the right ledger entries.

## Background

Liability accounts have inverted sign semantics versus asset accounts. When a credit card CSV shows a charge as a positive number, the correct ledger entry is a **negative** posting to the liability account (the debt increases) and a **positive** posting to the expense account. The current importer posts amounts as-is, which produces the wrong result for liabilities.

New liability accounts are created on the Assets page via the AddAccountWizard — no account creation flow is needed on the import page.

Closes **BUG-002** in BUGS.md.

---

## Decision: sign inversion strategy

**Option B — auto-detect from account path, with a manual override toggle in the UI.**

At preview time, the frontend checks whether the parser's default account path starts with `defaultLiabilitiesRootPath`. If yes, the "Import as liabilities" toggle is switched **on** by default. The user can flip it manually if the auto-detection is wrong (e.g. a liability CSV that already uses negative amounts).

When the toggle is on, all regular row amounts are negated before commit. Transfer rows are unaffected.

This keeps the backend simple (no new schema field) and gives the user an explicit escape hatch without requiring any permanent parser configuration.

---

## Stories

### 1. Build a Toggle component

- Reusable `Toggle.svelte` with `bind:checked` and an optional `label` prop
- Renders as a classic checkbox-style control consistent with the design system
- Used by the import preview panel (and potentially elsewhere)

### 2. Add "Import as liabilities" toggle to the preview panel

- Appears above the transaction table inside the Preview panel
- Auto-set to `true` on preview load if the parser's default account path starts with `defaultLiabilitiesRootPath`
- User can toggle it on or off regardless of the auto-detected value
- When on, all regular row amounts are displayed negated in the preview table so the user can see what will be committed

### 3. Negate amounts at commit time when toggle is on

- Frontend-side: before calling `importCommit`, negate the `amount` field on all non-transfer rows if the toggle is on
- No backend changes needed — the existing commit endpoint receives the final amounts as-is
- Write a test (or manual verification steps) covering: positive CSV amount + toggle on → negative liability posting + positive expense posting

