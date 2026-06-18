# Epic: Mobile Revival → MVP

**Goal:** Get the React Native (`mobile/`) app working again and aligned with the
current backend. Today it opens to a blank screen and — even if it booted — its API
client is built against the *pre-categories* fish-pie model, so expense entry returns
400. Ship a usable MVP: **log in, view groups, create and categorize expenses, view
netted balances.**

**Status:** Done — MVP shipped 2026-06-18 (stories 1–5). Stories 6–8 deferred.

**Scope decisions (2026-06-16):**
- **MVP bar = expense entry minus settle.** Create/categorize expenses + view
  balances/history. Settlement *confirmation* flow deferred to a follow-up story.
- **Design system deferred.** Keep current iOS-blue styling for the MVP; a
  Graphite/XP restyle is a separate later epic.
- **Category account-mapping is web-only.** Mobile assumes each member already mapped
  categories → accounts on the web app. Mobile picks among existing categories; it
  does not create or edit mappings.

---

## Background — how mobile fell behind

Mobile is a single scaffold commit (`5bdd0bb`) and has not been touched since. The
backend has since shipped Account Integration, Settlement Confirmation, Ledger Signs,
and Categories. Concrete drift:

- **Create expense is broken.** Mobile posts
  `{description, amount, currency, date, paidByUserId}`. Backend now **requires
  `paymentAccountId`** (400 otherwise) and accepts an optional `categoryId`. Mobile
  sends neither and has no concept of accounts.
- **No categories.** The entire categories system (group categories, per-member
  account mappings, shared per-category weights) is invisible to mobile.
- **Stale member shape.** `expenseGroupMembers` gained `defaultExpenseAccountId` and
  `defaultPaymentAccountId`; group GET now returns categories + the caller's mappings.
- **Stale settlement shape.** `groupSettlements` gained `status`, `payerAccountId`,
  and payer/receiver transaction ids (Settlement Confirmation epic). Mobile's
  create-settlement payload is likely rejected and there is no confirm flow.
- **Stale splits.** Mobile types `split.amount`; PATCH expenses now takes
  `splits: [{ userId, shareWeight }]` and category weights drive split computation.
- **Offline queue is a toy.** `createExpense` enqueues only *after* a failed POST,
  which is backwards; `flushOfflineQueue` works but is never wired to connectivity.
  Out of scope for MVP — leave the code, don't rely on it.

The blank screen itself is **not yet root-caused** — it needs a device/Metro run to
read the actual error (runtime JS error vs Expo SDK 52 issue vs a redirect that never
fires). Story 1 diagnoses it from the real stack trace; do not guess a fix.

---

## Reference points

- `frontend/src/lib/api.ts` — source of truth for the current API contract; mobile's
  `lib/api.ts` should mirror it.
- `backend/src/routes/fish-pie-expenses.ts` — create/patch expense contract
  (`paymentAccountId` required, `categoryId` optional, splits as `shareWeight`).
- `backend/src/routes/fish-pie-categories.ts` — categories CRUD + mappings + weights.
- `backend/src/routes/accounts.ts` — accounts list (mobile needs a client for this;
  has none today).
- `frontend/src/routes/(authed)/fish-pie/[id]/+page.svelte` and `.../settings` —
  the modern web UX to mirror behaviourally (not visually — design deferred).

---

## Stories

### 1. Boot & diagnose — get to a non-blank screen ✅ Done (#51)

Run the app on a device/emulator against a dev backend. Capture the real error behind
the blank screen and fix it. Confirm the happy path: launch → login (server URL +
credentials) → land on groups list → open a group. No API-contract work yet; just make
the existing screens render and navigate. Document the root cause in this epic file so
the next revival (if SDK bumps) is faster.

**Root cause (resolved).** Two compounding problems:

1. **SDK too old to run.** The project was on Expo SDK 52; the installed Expo Go and
   tooling had moved on, so the bundle never loaded on device ("Failed to download
   remote update"). The fix was to bump to **SDK 56** (RN 0.76→0.85, React 18→19,
   expo-router v4→v56). SDK 56 also dropped the `@react-navigation/native` direct-import
   compat shim, so `useFocusEffect` had to be imported from `expo-router` instead.
2. **Latent blank-render bug.** `app/_layout.tsx`'s bootstrap set `checked = true` only
   on the success path. If `isAuthenticated()` threw (e.g. a SecureStore read error), the
   flag stayed false and the layout returned `null` forever — a permanent blank screen
   with no error surfaced. Fixed by wrapping the bootstrap in `try/finally` so
   `setChecked(true)` always runs and a thrown check redirects to login.

**Dev workflow that works:** `bunx expo run:android` (a dev build — **not** Expo Go,
which can't host an SDK-56 dev-client project), reaching the backend over
`adb reverse tcp:8887 tcp:8887` with the login server URL set to `http://localhost:8887`.
The debug build carries a `.dev` applicationId suffix and a `have-fish-dev` label
(`plugins/withDebugAppIdSuffix.js`) so it coexists with the signed Obtainium release.

### 2. API client resync ✅ Done (#53)

Realign `mobile/lib/api.ts` types and calls with the current backend, mirroring
`frontend/src/lib/api.ts`:

- `GroupMember` gains `defaultExpenseAccountId`, `defaultPaymentAccountId`.
- `ExpenseGroup` GET payload gains `categories` (+ the caller's mappings/weights as
  the backend returns them).
- `GroupSettlement` gains `status`, `payerAccountId`, payer/receiver tx ids.
- `ExpenseSplit` / PATCH splits use `shareWeight`.
- Add category endpoints (read-only subset needed for MVP: list categories from the
  group GET; no create/edit/mapping from mobile).
- Add an **accounts** client (`fetchAccounts()`) — needed for the payment-account
  picker. Filter to the caller's own active accounts.
- `createExpense` payload gains `paymentAccountId` (required) and `categoryId`
  (optional).

No UI yet — this is the contract layer. Keep it a faithful mirror so future drift is a
diff against the frontend client.

### 3. Account picker + payment account ✅ Done (#54)

Mobile has no way to choose an account today. Add a lightweight account picker
(fetch the caller's accounts, group/sort sensibly, search if the list is long). Used
by the expense form to supply `paymentAccountId`, pre-filled from the member's
`defaultPaymentAccountId` when present.

### 4. Category-aware expense entry ✅ Done (#55)

Rework `ExpenseForm` + `createExpense` to the new contract:

- Category chips (horizontal row), defaulting to last-used category for the group
  (persist locally, like the web's sticky default). Categories come from the group GET.
- Payment account picker (story 3), pre-filled from `defaultPaymentAccountId`.
- Payer chips (existing) — `paidByUserId`.
- On submit, post the full payload; surface backend validation errors inline.
- Edit path: PATCH with `categoryId` / `splits` as needed (recategorization).

Expense list rows show a category pill.

### 5. Balances & history against the netted single-group model ✅ Done (#56)

Verify `BalanceCard` / `ExpenseList` / `SettlementList` render correctly against the
current balances and overview endpoints (single group, cross-category netting). Fix
type/shape mismatches. **View-only for settlements** in the MVP — the settle button
and `SettleModal` are deferred to story 6; either hide the settle affordance or leave
it disabled with a "settle on web for now" note.

### 6. (Deferred) Settlement confirmation flow

Bring mobile up to the Settlement Confirmation model: `payerAccountId` on create,
pending/confirmed states, the confirm action. Out of the MVP; tracked here so it
isn't lost.

### 7. (Deferred) Graphite/XP design pass

Port design tokens to React Native and restyle screens on-brand. Separate later epic.

### 8. (Deferred) Real offline queue

Proper optimistic-create + connectivity-driven flush. The current code is a stub;
either finish it or rip it out. Not MVP.

---

## Outcome (2026-06-18)

MVP shipped: **log in → groups → create/categorize expenses → view netted balances**,
running as a coexisting `have-fish-dev` debug build and validated on the signed CI
release path. Stories 1–5 merged (#51, #53, #54, #55, #56) plus the dev-label change
(#52). Stories 6–8 remain deferred as separate future work:

- **6 — settlement creation/confirmation.** `SettleModal.tsx` is left in the tree
  (orphaned, not wired) as the starting point; balances are view-only for now.
- **7 — Graphite/XP design pass.** Screens still use the scaffold's iOS-blue styling.
- **8 — real offline queue.** The stub in `lib/api.ts` is left as-is.

## Sequencing notes

- Stories 1→5 are the MVP and are roughly linear (2 unblocks 3/4; 5 needs 2).
- Land **after** the in-flight backend fish-pie work is stable on `main` (Categories
  is `Ready`, Ledger Signs `In Progress`) so the contract mobile mirrors isn't moving
  underneath it.
- Each story ships as its own PR against `main` per the normal epic workflow.

## Out of scope (MVP)

- Settlement creation/confirmation from mobile (story 6).
- Design-system restyle (story 7).
- Real offline support (story 8).
- Category management / account mapping from mobile — web-only by decision.
- Merge flow, invites rework, per-category balance breakdown.
