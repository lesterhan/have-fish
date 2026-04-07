# Epic: Illiquid Account Flags

Goal: Let the user mark individual accounts as "illiquid" — excluded from cash position and runway calculations on the dashboard. Examples: FHSA (locked for first home purchase), long-term investment accounts you won't touch for years.

## Background

The dashboard's Cash Position panel sums all asset balances to calculate cash on hand and runway. But some assets aren't really available money — they're locked for a specific purpose or deliberately untouchable. This epic adds a per-account flag to exclude those accounts from cash calculations.

The flag is stored in the existing `preferences` JSONB column on `user_settings` — no schema migration needed. The pattern is identical to how `hiddenAccountIds` works today.

The cash/planning calculations on the dashboard will be redesigned in a future epic. This epic just lays the groundwork: the flag, the toggle, and the one place where it currently matters (cash position panel).

---

## Stories

### 1. Type-level — add `illiquidAccountIds` to preferences

Frontend / `src/lib/api.ts` (or wherever `UserSettings` is typed) + `settingsStore`.

- Add `illiquidAccountIds?: string[]` to the `UserSettingsPreferences` type (or equivalent shape)
- No backend changes — `preferences` is already a free-form JSONB blob and `PATCH /api/user-settings` already accepts arbitrary preference keys
- Helper derived from `settingsStore`: `illiquidIds = $derived(new Set(settingsStore.value?.preferences.illiquidAccountIds ?? []))`

### 2. Account settings — "Exclude from cash" toggle

Frontend / `AccountSettings.svelte` + the single account page that hosts it.

- Add a new setting row: label "Cash & planning", control button with the same style as the existing "Sidebar visibility" toggle
- States: "Included — click to exclude" / "Excluded — click to include" (mirroring the hidden/visible pattern)
- Clicking updates `preferences.illiquidAccountIds` via `settingsStore.update()`, adding or removing the account's ID
- The account page must pass the current illiquid state and a toggle callback into `AccountSettings`, following the same prop pattern as `hidden` / `ontogglehidden`

### 3. Dashboard — filter illiquid accounts from cash position

Frontend / `dashboard/+page.svelte`, `loadCash()`.

- Load `illiquidAccountIds` from `settingsStore` alongside the existing `loadCash()` data
- When summing asset balances into `cashTotals`, skip any account whose ID is in `illiquidAccountIds`
- Below the cash total for each currency, add a small muted line: "N account(s) excluded" — visible only when at least one account is excluded for that currency. This is just an informational hint; no interactivity needed here.
