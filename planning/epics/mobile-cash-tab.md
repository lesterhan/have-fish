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

**Decision: strict `resolvedType === 'cash'`.** No path heuristics, no fallback. A ledger
with nothing tagged gets the create-a-wallet wizard (Story 3), which tags what it creates —
so the strict rule never leaves the user stranded on a screen that can't help them.

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

### 3. Wallets tab + first-wallet wizard

- Cash accounts with per-currency balances, one card per wallet, newest activity first.
- Tap selects the **active wallet**; persisted (`LAST_WALLET_KEY`), and it drives the Spend
  and History tabs and the Cash header.
- Pull-to-refresh; offline tolerated (last-loaded balances stay on screen).

**No cash accounts yet → the wizard runs instead of an empty state** (decided 2026-08-27).
Cash mode is never hidden; the tab explains itself and gets the user to a usable wallet
without leaving the phone:

1. A short intro card — what a cash wallet is here, and that one is made per currency.
2. A currency picker, reusing `CurrencySheet` (recents + full list) so it matches the rest
   of the app.
3. Path preview: the prefix `assets:cash:` is fixed and shown read-only, the leaf is the
   chosen currency lowercased → `assets:cash:cny`. An optional display name defaults to
   something like "Cash (CNY)". A user who wants a different path uses the web app; this
   flow is deliberately narrow.
4. Create: `POST /api/accounts` with `path` + `defaultCurrency`, then `PATCH
   /api/accounts/:id` with `type: 'cash'` so the account satisfies the strict tag rule the
   whole mode filters on. **The tag is not optional** — an account created here that failed
   to tag would be invisible to the very screen that made it, so the two calls are treated
   as one operation: on a failed PATCH, surface the error and offer retry rather than
   leaving an untagged orphan (a follow-up `PATCH` on an existing account is idempotent, so
   retry is safe).
5. Land on the new wallet, selected and ready to spend against.

The same flow is reachable as "Add a wallet" from the populated Wallets tab — a traveller
crossing a border needs a second wallet, not a first one, and it is the same three taps.

- Guard: a currency that already has a wallet is disabled in the picker with its existing
  wallet named, so the flow can't mint `assets:cash:cny` twice.
- Pure logic in `mobile/lib/cash-wallet-create.ts` (RN-free, bun-tested): path assembly
  from a currency code, default display name, duplicate-currency detection, validation of
  the resulting path against the same rules the backend enforces.

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
- **Fish Pie transactions appear here too** and must read as such. Funding a group expense
  from a wallet is supported today (see "Cash and Fish Pie" below), so the feed will
  contain 3-posting group transactions whose legs are wallet `−total`, receivable
  `+others' share`, expense `+your share`. Render these with a group badge and
  "you paid 180.00 · your share 90.00" framing — never as an anonymous three-leg list.
- Running wallet balance so the feed can be reconciled against the actual notes in pocket.
- Refresh on focus and after any Spend / top-up, matching the pie tabs' `reloadData` habit.

### Stretch

- Retag an *existing* account as Cash from mobile — Story 3 creates and tags new wallets,
  but adopting a wallet that already exists in the ledger still means a trip to the web app.
- Reuse the split-row component for the web import preview, closing
  `planning/epics/split-transactions.md` story 1 with shared logic.

## Cash and Fish Pie — funding a group expense from a wallet

Checked 2026-08-27. **No blockers; this works today and needs no backend change.**

- `POST /api/fish-pie/groups/:id/expenses` validates the payment account by **ownership
  only** — belongs to the payer, not deleted (`fish-pie-expenses.ts:136`). No account-type
  restriction exists anywhere on that path.
- `fish-pie-expense-service.ts:171-183` writes the payment account as a plain `−total` leg,
  so a wallet behaves identically to a chequing account. A cash-funded group dinner is the
  usual 3-posting shape: `assets:cash:cny −180 / assets:receivable:<slug> +90 /
  expenses:food +90`.
- Role classification is correct: `classifyPosting` resolves `assets:cash:cny` → `asset` →
  role `transfer` (the funding leg, not the subject). Note the mechanism — `roles.ts:50`
  calls `resolveAccountType`, which is inference-only and never consults the stored
  override. It lands on the right answer because the per-currency convention keeps wallets
  under the assets root, and an atypically-pathed cash account would hit the `default:`
  branch and also return `transfer`. Right either way, but by luck rather than design; a
  consistency gap worth closing when `roles.ts` is next touched, not here.
- The wallet balance stays honest without adjustment: the notes really did leave your
  pocket, and the amount owed back sits in the receivable account.

Two things this imposes on the design:

1. **The Spend tab must not read as "all cash spending goes here."** A cash-funded group
   expense belongs on the Fish Pie Add tab with the wallet selected as payment account.
   Entering it in both places double-counts it. The mode split keeps the two ledgers
   distinct, which is the point — but the copy must not imply that spending cash obliges
   you to use Cash mode.
2. **Story 6 renders group transactions with group framing** (see above).

One pre-existing wrinkle, worth knowing rather than fixing here: creating a group expense
stamps that payment account as the member's `defaultPaymentAccountId`
(`fish-pie-expenses.ts:154`), so one cash-funded dinner makes cash the pre-selected payer
account for the *next* group expense. Cash payments are sporadic, so this will be noticed
more once wallets exist. Not caused by this epic; log it separately if it grates.

## Decisions

- **2026-08-27 — one Cash account per currency** (`assets:cash:cad`, `assets:cash:cny`).
  Cleanest, keeps each balance unambiguous, and follows the per-currency pattern the ledger
  already uses for Wise. Accepted cost: it mints a lot of leaf accounts over time. Tracked
  as a future cleanup in `planning/TASKS.md` → Accounts → "Account proliferation" — not a
  blocker for this epic.
- **2026-08-27 — Cash mode is never hidden.** With no cash accounts, the Wallets tab runs
  a create-a-wallet wizard (Story 3) instead of a dead empty state. Extra scope, taken
  deliberately: it removes the web dependency that the strict-tag rule would otherwise
  impose on a brand-new user.
- **2026-08-27 — the expense-split editor is cash-only for this epic.** It ships on the
  Spend tab (Story 4). The Fish Pie Add tab does not get it: a group expense carries one
  Fish Pie `categoryId` (which drives per-category split weights), not an expense account,
  so splitting there means either N expense postings under one category or N categories per
  expense — the latter reshapes the weight-resolution model. Revisit separately once the
  editor has earned its keep. See the note at the end of this file.
- **2026-08-27 — strict `resolvedType === 'cash'`.** No path heuristics. Story 3's wizard
  is what makes this affordable.

## Open questions

None outstanding — the epic is ready to start at Story 1.

## Note — what "the split editor" means

The component in question: under the amount hero, instead of one expense-account picker,
a small list of rows, each `(expense account, amount)`, with a running **unallocated**
figure. Enter 180 in the hero, assign 90 to `expenses:food` and 60 to
`expenses:household`, and the row area reads "30.00 left" until the last row is filled;
Add stays disabled until the remainder is exactly zero. Adding a row starts it at the
current remainder, so the common two-way split is: tap add, pick account, type the first
amount, tap add, pick account — the second amount is already right.

It exists because one physical purchase is often several ledger categories: the Costco run
in `planning/epics/split-transactions.md` is $180 spanning food, household, and
electronics. Today the only way to record that is three separate transactions (which
misrepresents one payment as three) or one lumped category (which loses the breakdown).
The backend has always accepted N postings; nothing in the app produces them.

For **cash** (Story 4) this is settled — it ships there.

The **Fish Pie Add tab does not get it** (decided 2026-08-27). A group expense carries
exactly one `categoryId`, which is a Fish Pie concept driving per-category split weights,
not a ledger expense account. Putting the editor there is not a drop-in: it means either N
expense postings under one category, or N categories per expense, and the second reshapes
the Fish Pie data model and its weight resolution. Much larger than the cash case, and
likely its own epic. Nothing in the cash design forecloses it.
