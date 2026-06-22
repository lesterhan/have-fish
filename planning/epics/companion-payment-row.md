# Epic: Companion Payment Row

Goal: Make the mobile Add screen self-sufficient by giving it an in-app **payment account** picker, and relieve its vertical pressure by collapsing the **Paid by** block into a compact, sentence-style chip row placed below the numpad. The screen should read top-to-bottom as: amount + currency → description → category → numpad → *"Les from liabilities:visa"* → **Add Expense**.

## Background

The Add screen (`mobile/components/SpeedEntry.tsx`) today derives the payment account *only* from the payer's `member.defaultPaymentAccountId`, which can only be set on the web app. When it's unset, the screen shows a dead-end guard — "Set a default payment account for Les on the web app to add expenses." — and the CTA is disabled. You can't actually add an expense from a fresh install without going to a desktop. This is the screen's biggest usability hole.

Separately, the **Paid by** control (`PaidBySegments.tsx`) renders a full-width two-segment block (avatar + name + `% share`). It's high-prominence but low-usage: the payer defaults to whoever opened the app (`defaultPayerId` by email) and rarely changes. It eats a vertical block the screen can't spare.

This epic merges both fixes onto one line. Below the numpad (the least-touched region, since these are sticky defaults that read as confirmation rather than input), a single row shows two chips joined by a quiet connective:

```
(💰 Les)  from  (…:visa)
```

- **Left chip — payer.** Shows the current payer's name with a small leading icon. For a 2-member group, tapping it flips directly to the other member (no sheet). For 3+ members it opens a select sheet. Content-sized.
- **Connective — "from".** Static `ink3` text, not a tap target.
- **Right chip — payment account.** Shows the selected account's leaf (head-truncated, e.g. `…:visa`). Tapping opens the existing `AccountSelect` sheet (scope chips + fuzzy search + inline create). Flexes to fill remaining width.

The `AccountSelect` component already exists and is wired into `ConfirmSheet` and `SettleSheet`; this epic reuses it. The account chip seeds from the payer's `defaultPaymentAccountId` but is user-overridable, which removes the web-app dependency and lets the chip itself be the fix when no default exists.

**Reading order rationale:** the amount + currency hero is the one loud thing; description and category are per-entry inputs; the numpad is a hard horizontal break; the payer/account row sits after it as a glanceable confirmation of *who paid from where*, immediately above the commit. This mirrors the natural sentence "Les paid 150.55 from Visa."

### Design decisions (baked in from review)

- **Icon, not emoji** for the payer chip's leading glyph — an Ionicon (`wallet-outline` or similar) tinted to match the existing `calendar-outline` date chip, for visual coherence with the curated rust/serif aesthetic. (Avoids Android's inconsistent emoji rendering.)
- **Head-truncate the account path**, never the leaf: show `…:visa`, never `liabilities:cre…`. The leaf is the identifying part.
- **Layout invariant:** the row must never push the CTA off a 412×892 frame. Account chip `flex: 1`; payer chip content-sized; both single-line with ellipsis.
- **2-member fast path:** tap payer = instant flip, no sheet. Sheet only for 3+ members.
- **Re-seed on payer change:** flipping the payer re-seeds the account to *that* member's `defaultPaymentAccountId`, unless the user has manually overridden the account this session (a `userTouchedAccount` flag). Manual override wins until the screen unmounts.
- **No web guard:** delete the "set on web" message entirely. When no account resolves, the account chip renders an empty/required state ("Select account") and the CTA stays disabled until one is chosen — the chip is the affordance to fix it.

---

## Stories

### 1. `lib/payment-row` — payer + account resolution helpers (RN-free, tested)

`mobile/lib/payment-row.ts` + `mobile/lib/payment-row.test.ts`.

Pull the resolution logic out of the component into a pure, testable helper module (mirrors the `account-search.ts` / `group-entry.ts` pattern — logic in lib, component is a render shell).

- `seedAccountForPayer(group, payerId): string` — returns the payer member's `defaultPaymentAccountId` or `''`.
- `nextPayerOnTap(group, currentPayerId): string` — for a 2-member group returns the *other* member's id (instant flip); for 1 or 3+ members returns `currentPayerId` unchanged (the component opens a sheet instead).
- `shouldOpenPayerSheet(group): boolean` — `true` when `group.members.length > 2`.
- A small reducer or helper for the override rule: given `(prevPayer, nextPayer, userTouchedAccount, currentAccountId)`, decide the next `accountId` — re-seed on payer change unless `userTouchedAccount`.

Comprehensive unit tests: 1-member, 2-member (flip both directions), 3-member (no flip), seed when default present / absent, override-wins-on-payer-change, re-seed-when-not-touched. No React, no RN imports — these run under `bun test`.

### 2. `PaymentRow` component — the chip row

`mobile/components/PaymentRow.tsx`.

A presentational row: payer chip (left, content-sized) + `from` connective (`ink3`) + account chip (right, `flex: 1`). Uses the same chip visual language as the date chip in `AmountHero` (small, low-prominence, token-driven). Props:

```ts
interface Props {
  group: ExpenseGroup
  payerName: string
  accountLabel: string | null   // leaf, head-truncated; null → "Select account"
  accountMissing: boolean        // drives the required/empty visual state
  onPressPayer: () => void
  onPressAccount: () => void
}
```

- Payer chip: leading Ionicon + name, single line.
- Account chip: leaf label with head-truncation (`…:visa`), `flex: 1`, ellipsizes; renders an empty/required state when `accountMissing`.
- No business logic in the component — parent passes resolved labels and handlers.
- All values from `theme`; no hardcoded colors (the `lint:tokens` guard enforces this).

Truncation helper (head-priority) lives in `lib/` with a test if `accountLeaf` doesn't already give the right string.

### 3. Wire into `SpeedEntry` — account state, AccountSelect sheet, payer flip

`mobile/components/SpeedEntry.tsx`.

- Fetch the caller's accounts via `fetchAccounts()` (load once; tolerate offline — empty list still lets the sheet's inline-create work).
- New state: `paymentAccountId`, `userTouchedAccount`. Seed `paymentAccountId` from `seedAccountForPayer` on mount and on payer change (respecting the override rule from Story 1).
- Replace the `PaidBySegments` block with `PaymentRow`, moved to **below the `Numpad`** and above the guard/CTA.
- Payer chip handler: if `shouldOpenPayerSheet(group)` open a payer select sheet (new lightweight `BottomSheet`, or reuse an existing select pattern); else apply `nextPayerOnTap` directly.
- Account chip handler: open `AccountSelect` (as a controlled sheet, or wrap its trigger). On select, set `paymentAccountId` + `userTouchedAccount = true`. On inline create, fold the account into local list (its `onCreate`).
- Submit now reads `paymentAccountId` from state (not `payerDefaultAccountId`). `canSubmit(amount, paymentAccountId)` is unchanged but now fed by the picker.
- **Delete** the `paymentAccountId == null` web-app guard `Text` entirely.
- Remove the now-unused `PaidBySegments` import (and the component file if nothing else references it — confirm with grep first).

Keep the existing stickiness conventions intact (currency / category / date persistence). Payer stays defaulted-to-opener; the account is not persisted across launches in this epic (it re-seeds from the member default each open) unless we decide otherwise — note this as an open question rather than implementing silent persistence.

### 4. Update / add component + integration coverage

- Update any existing `SpeedEntry` / payment-related tests for the new structure.
- Tests for the Story 1 helpers are the core safety net (pure logic).
- If the project has RN component test infra, add a focused test that the CTA enables once an account is selected and disables when cleared; otherwise rely on the helper tests + a manual verification note.
- Run `bun run lint:tokens` and the mobile test suite; confirm green.

---

## Out of scope

- Cross-launch persistence of the chosen payment account (re-seeds from member default each open for now — flagged as an open question in Story 3).
- Editing a member's share weight from this screen (the old `% share` readout is dropped; share is a group setting, not a per-expense control).
- Theming / dark mode (separate **Companion Theming** epic).
- Muting the currency pill (tracked separately as a small polish task, done after the theming epic).
