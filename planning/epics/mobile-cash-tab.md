# Epic: Mobile Cash Ledger

Goal: Give the Companion a second, clearly-separated mode for working a **cash wallet** —
log cash spend (splittable across expense accounts), see what's in each wallet across
currencies, record top-ups/withdrawals, and scan cash history. Personal ledger, not Fish Pie.

Status: **Scoping** — design agreed 2026-08-27, stories not started.

## Why now

Travelling means carrying physical cash in several currencies. Cash spend has no CSV to
import and no bank feed (by design — vision principle 1), so it is the one category of
transaction that *must* be entered by hand, in the moment, on the phone. Today the
Companion can only enter **Fish Pie group expenses**; the personal ledger is web-only.

## Findings from the codebase (2026-08-27)

### hledger account types — already shipped ✅

The feature exists end to end, so "find the cash accounts" needs no new data model:

- `accounts.type` column (`backend/src/db/schema.ts:66`) — a nullable **stored override**.
- `backend/src/postings/account-type.ts` defines `StoredAccountType` =
  the five inferable types **plus `cash` and `conversion`**. `cash` is *override-only* —
  path inference can never produce it, so a cash account is one the user has **explicitly
  tagged**. That is exactly the signal this epic wants.
- `resolveStoredOrInferredType()` — stored-wins-else-infer. One resolver, all consumers.
- `PATCH /api/accounts/:id` accepts `type` and validates against the seven-value set
  (`backend/src/routes/accounts.ts:392`).
- `GET /api/accounts` returns `resolvedType` on every row; `GET /api/accounts/:id` also
  returns `inferredType`.
- Web UI: the Type dropdown in `AccountSettings.svelte` (Auto / Asset / **Cash** /
  Liability / Equity / Income / Expense).

**Decision: strict `resolvedType === 'cash'`.** No path heuristics, no fallback. An
untagged ledger shows an empty state pointing at the web app. Tagging from mobile is out
of scope for this epic.

### What the split foundation actually gives us

The reusable part is the **entry UI**, not a data-model change:

- `AmountHero` + `Numpad` + `lib/amount-input.ts` — the mono amount hero and its input model.
- `AccountSelect` + `lib/account-search.ts` — fuzzy account picker with root chips and
  inline create.
- `CurrencySheet` / `DateSheet` / `GlossButton` / `Label` / `BottomSheet` — the sheet kit.
- `POST /api/transactions` (`backend/src/routes/transactions.ts:229`) already accepts **N
  postings** and validates per-currency balance to zero. A split cash purchase is just
  `[wallet −180 CAD, expenses:food +90, expenses:household +60, expenses:electronics +30]`.
  No backend work for splits.

`mobile/components/SplitSheet.tsx` is the Fish Pie *member weight* slider — unrelated, and
must not be confused with expense-account splitting. Name the new one `SplitRows` (or
similar) to keep the distinction obvious in the tree.

The `planning/epics/split-transactions.md` epic (web import preview) stays in the backlog
and is **not** a prerequisite.

### The confusion risk this epic must solve

The Companion shell is group-scoped *everywhere*: `GroupProvider` wraps the tab navigator,
`AppHeader` shows a group switcher on every screen, and all four tabs render through
`GroupScreen`. Dropping a Cash tab into that bar would put a personal-ledger screen under a
Fish Pie header — the exact "am I adding this to the group or not?" ambiguity to avoid.

**Decision: restructure the shell into two modes** (agreed 2026-08-27).

### Gaps found that this epic has to close

1. **`GET /api/accounts/balances` ignores the stored type override.** It selects by path
   root (`like(path, 'assets:%')`) and re-derives the type with `resolveAccountType` —
   pure *inference* — collapsing anything unplaceable to `equity`
   (`backend/src/routes/accounts.ts:105-120`). A wallet tagged Cash but living under an
   atypically-named root (`储蓄:现金`) is invisible there. That is a latent web bug too;
   log it in `planning/BUGS.md` and fix the mobile path additively (Story 1).
2. **Mobile's `Account` type has no `type` / `resolvedType`** (`mobile/lib/api.ts:95`) —
   the backend already sends them, the mirror is just stale.
3. **Mobile has no personal-ledger API calls at all** — no `createTransaction`, no
   `fetchTransactions`. Everything in `mobile/lib/api.ts` is groups/expenses/settlements.

## Shell restructure — how the two modes work

Two ledgers, one app, never ambiguous:

| | Fish Pie mode | Cash mode |
|---|---|---|
| Header | group name + "n members · CCY" + gear | wallet name + balance + wallet switcher |
| Tabs | Add · Balances · History · Account | Spend · Wallets · History · Account |
| Accent | existing rust accent | a distinct cash accent (new token) |
| Data scope | `GroupProvider` | `WalletProvider` (new) |

**Mechanism (recommended):** a `ShellModeProvider` above the tab navigator holding
`'pie' | 'cash'`, persisted to AsyncStorage like `LAST_GROUP_KEY`. All seven screens stay
registered on the one `Tabs` navigator; the inactive mode's screens get `href: null`. One
tab bar, no nested navigators, no duplicated `Account` route, state preserved across
switches. Fallback if `href: null` toggling proves janky in Expo Router: a root `Stack`
under `(app)` with `(pie)/` and `(cash)/` each owning their own `Tabs`, at the cost of a
duplicated Account route file.

**The switch itself:** a two-pill segmented control in the header — always visible, so the
mode is legible before you type an amount. Combined with the accent swap and a different
tab set, there is no screen where the current ledger is in doubt.

`GroupProvider` stays mounted in both modes so switching back is instant; `GroupScreen`
keeps its current job for the pie tabs only.

---

## Stories

### 1. Cash account plumbing

Backend + mobile API layer. No UI.

- `GET /api/accounts/balances` gains an optional `?types=` filter (CSV of stored types).
  When present, select accounts by **resolved** type (`resolveStoredOrInferredType`,
  stored-wins) instead of by path root, so a Cash-tagged account outside the assets root is
  included. Response rows gain `resolvedType`. **The no-param behaviour is unchanged** —
  the web dashboard and balances page are untouched.
- Mobile `Account` gains `type?: StoredAccountType | null` and
  `resolvedType?: StoredAccountType | null`.
- New `mobile/lib/cash-accounts.ts` (RN-free, bun-tested): `isCashAccount()`,
  `cashAccounts()`, wallet display label, per-currency balance formatting.
- New mobile API helpers: `fetchCashBalances()`, `createTransaction()`,
  `fetchTransactions({ accountId })`. `createTransaction` routes through the existing
  offline queue like `createExpense` does.
- Tests: backend route tests for the `types` filter (tagged-cash-outside-assets-root
  included; unfiltered response byte-identical to today); bun tests for `cash-accounts.ts`.
- Log the `/balances` inference bug in `planning/BUGS.md` as a separate web-side follow-up.

### 2. Shell restructure — two modes

Mobile shell only. Cash screens are placeholders at the end of this story.

- `ShellModeProvider` + `useShellMode()`, persisted last mode.
- Header mode switcher (segmented pills); `AppHeader` splits into `PieHeader` / `CashHeader`
  behind one shell header component.
- New `cashAccent` (and soft variant) tokens in `mobile/lib/theme.ts`; tab bar active tint,
  amount hero, and primary button read the mode's accent. `lint:tokens` must still pass.
- Tab registration driven by mode (`href: null` for the inactive set).
- Pure mode-resolution logic in `mobile/lib/shell-mode.ts` with bun tests (persisted value
  restore, invalid stored value, default).
- **Acceptance:** the four existing Fish Pie tabs behave exactly as before; switching to
  Cash mode changes header, tab set, and accent; the last mode is restored on relaunch.

### 3. Wallets tab

- Cash accounts with per-currency balances, one card per wallet, currencies stacked.
- Tap selects the **active wallet**; persisted (`LAST_WALLET_KEY`), and it drives the Spend
  and History tabs and the Cash header.
- Empty state when no account is tagged Cash: explains the Type → Cash setting in the web
  app. This is the strict-tag rule's cost and it must read as guidance, not an error.
- Pull-to-refresh; offline tolerated (last-loaded balances stay on screen).

### 4. Spend — cash entry with expense splits

The core screen. Reuses `AmountHero`, `Numpad`, `CurrencySheet`, `DateSheet`,
`AccountSelect`, `GlossButton`.

- Wallet chip (active wallet, tappable to switch) → amount hero → description → expense
  account picker (`AccountSelect` scoped to the `expenses` root) → Add.
- **Split mode:** add rows of (expense account, amount). A running "unallocated" figure
  shows the remainder; Add is enabled only when the rows sum exactly to the hero amount.
  Removing rows folds the amount back into the remainder.
- Submits `POST /api/transactions` with `[wallet −total, ...expense legs +each]`, matching
  the double-entry convention in `planning/epics/split-transactions.md`.
- Single-currency only in this story: every leg carries the wallet's currency.
- Offline queue + the "Saved offline" outcome, mirroring `expense-submit.ts`.
- All logic in `mobile/lib/cash-entry.ts` (RN-free, bun-tested): remainder maths, split
  validation, posting assembly, balance-to-zero assertion, submit-enabled predicate.
- **Acceptance:** a three-way split lands as one four-posting transaction, visible on the
  web transaction detail with the correct flow narration.

### 5. Top-ups and withdrawals

Moving money *into* a wallet — the ATM stop and the exchange counter.

- Same-currency (bank → wallet): two postings, source `−`, wallet `+`. Source picked with
  `AccountSelect` scoped to assets/liabilities.
- Cross-currency (CAD account → CNY cash): the established 5-posting
  `equity:conversion` bridge from the Currency Transfers epic — source `−` in its currency,
  conversion `+` same currency, conversion `−` in the target currency, wallet `+` target,
  optional fee leg. Requires `userSettings.defaultConversionAccountId`; when unset, the
  cross-currency path is disabled with a pointer to the web setting rather than inventing
  an account.
- Effective rate shown before submit so a bad counter rate is obvious.
- Pure builder + tests in `mobile/lib/cash-entry.ts` — both posting shapes, fee handling,
  per-currency balance assertions.

### 6. Cash history

- `GET /api/transactions?accountId=<wallet>` feed for the active wallet, newest first,
  grouped by day, each row showing the counter-account(s) and signed amount.
- A split transaction renders as one row that names its legs (not N rows).
- Running wallet balance so the feed can be reconciled against the actual notes in pocket.
- Refresh on focus and after any Spend / top-up, matching the pie tabs' `reloadData` habit.

### Stretch

- Tag an account as Cash from mobile (`PATCH /api/accounts/:id`) so a wallet can be created
  and designated on the road — removes the web dependency in Story 3's empty state.
- Reuse the split-row component for the web import preview, closing
  `planning/epics/split-transactions.md` story 1 with shared logic.

## Open questions

1. **Does the split editor belong on the Fish Pie Add tab too?** Group expenses currently
   take a single category. Same UI, different submit path — worth it, or scope creep?
2. **Multi-currency wallets:** one Cash account per currency (`assets:cash:cny`), or one
   wallet holding several currencies? Story 3 renders either, but Spend needs to know
   which currency it is spending; per-currency accounts is the simpler answer and matches
   the Wise pattern already in the ledger.
3. **Should Cash mode be hidden entirely** until at least one account is tagged Cash, to
   keep the shell simple for users who do not carry cash?
