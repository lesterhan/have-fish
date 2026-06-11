# Exploration: Fish Pie experience overhaul

Working doc. Notes-to-self for continuing investigation across sessions. Not polished.
Started 2026-06-11. Round 1 = code archaeology + first findings.
Round 2 (same day) = Lester's decisions + deep dive on flows/rules/reports/ledger signs.

## Decisions from Lester (2026-06-11)

- **R1 single-group direction: conditionally approved.** Main worry = expense-add UX
  overload. Proceed only with frictionless quick-logging flow. → see "Flow designs".
- **Mobile: defer.** Fix after backend model is solid (post-restructure). Known broken,
  accepted for now.
- **R5 FX consolidation at settle: approved.**
- **R3 proposals tweak (warn-not-block settle): approved.**
- **R4 rules auto-split: approved in principle, BUT rules themselves "not working as
  well as I'd like" — needs an import-rules epic first.** → see "Rules assessment".
- **R6 notifications: wanted.** Settlements already notifiable today. Ledger-semantics
  pass: "very valuable", he wants it done well (not an hledger expert himself).
- **F7 slider mutating group weights: intentional for now**, revisit later.

## Decisions from Lester (round 3, same day)

- **All groups are 2-person; split weights DIFFER per group** (Housing 60/40,
  Food 70/30). → categories epic MUST carry per-category default weights in the
  merge migration (see flow design schema — weights live on
  `groupCategoryMemberAccounts`, falling back to group weights).
- **Flow A (category chips) approved** → categories epic drafted:
  `planning/epics/fish-pie-categories.md`.
- **F13 VERIFIED with a real failing test** (scratch test, deleted after run):
  B's share of A's $100 dinner → `expenses:food` posting `-50.00`, B's
  spending-summary total `CAD -50.00`. Recorded as **BUG-005** in BUGS.md.
  Ledger-signs epic drafted: `planning/epics/fish-pie-ledger-signs.md`.
- Q3 (rename `group:` → `assets:receivable:…`) explained to Lester; awaiting his
  call. Rename is staged as an optional story in the ledger-signs epic, bundleable
  with the categories merge migration to avoid two account churns.

## Decisions from Lester (round 4, same day)

- **Ledger-signs fix: GO.** Epic started (status In Progress).
- **Rename approved**: `assets:receivable:<slug>`, bundled into categories merge
  migration (categories epic story 3 updated; ledger-signs story 3 removed).
- **Canonical epic order now documented in `planning/ROADMAP.md` § "Fish Pie
  sequence"** — that's the resume point for future sessions, not this doc.
- New bug found while scoping the fix: **BUG-006** — web edit omits
  `paymentAccountId` → PATCH rebuilds payer tx via legacy 2-posting branch, source
  posting lost. Filed in BUGS.md; fix deferred (PATCH fallback to
  `defaultPaymentAccountId`), fully superseded by proposals epic. Because that
  legacy branch is still reachable, the sign flip is scoped to non-payer txs only
  (`split.userId !== payerId`).

## The brief (from Lester)

Two primary use cases:

1. **Import-time sharing** — during CSV import, mark a row as shared (Food, Housing,
   Shows, Gifts…). Lives in `ImportPreviewPanel` + row components.
2. **On-the-go entry** — while traveling, either partner quickly logs expenses,
   including expenses the *other* person paid. Tally at month end, settle once.

Stated pain: feature grew from "Splitwise clone" into deep ledger integration
(expenses post into each member's real accounts) and he's been chasing problems since.
New pain he named: **cross-group netting** — she owes $100 in Housing, he owes $100 in
Food → shouldn't require two transfers.

Pending epic (not implemented): `planning/epics/fish-pie-expense-proposals.md` —
proposed/active expense states so non-payers can enter expenses without knowing the
payer's account.

## Architecture map (verified in code 2026-06-11)

Tables (`backend/src/db/schema.ts:170-243`):
- `expenseGroups` (name, defaultCurrency, createdBy)
- `expenseGroupMembers` — per member per group: `shareWeight`,
  `defaultExpenseAccountId` (where their share posts, e.g. expenses:food),
  `defaultPaymentAccountId` (payer source, auto-saved on use)
- `groupExpenses` — paidByUserId, amount, currency, date,
  `transactionId` (import-link, opposite-direction FK)
- `groupExpenseSplits` — computed amounts per member (hard-deleted on edit, no soft delete)
- `groupSettlements` — from/to, status pending|completed, payer+receiver transactionIds

Posting patterns (`fish-pie-expense-service.ts`, BUGS.md primer):
- Manual payer (3-posting): source −total / group:slug +others / expenses:cat −payer-share… (sign conv: payer expense posting is `split.amount` positive in service code line 115 — re-verify signs next round)
- Non-payer member (2-posting): expenses:cat −share / group:slug +share
- Import-linked (3-posting on import tx): source / group: / expense, payer member tx skipped (`skipPayerMemberTx`)
- Settlement payer: source −amt / group:slug +amt; receiver confirm: receiver +amt / group:slug −amt

Balances (`fish-pie-balances.ts`): recomputed from `groupExpenses`+splits+completed
settlements, **per currency**, greedy debt simplification (`simplifyDebts`). Ledger
`group:` accounts are cosmetic — balances never read postings.

Flows:
- Import: `ImportPreviewPanel` → `ImportRowRegular/Transfer` → `GroupSelect` (portal
  dropdown, recent-groups sorted via settingsStore). One group per row. Share-hint pill
  shows my share. Category = my `defaultExpenseAccountId` in that group, NOT choosable
  per row. Backend `routes/import.ts:249-` validates `groupSplits[]` {rowIndex, groupId}.
- Web group page: `GroupRightPanel.svelte` (1188 lines — NOT yet read),
  `GroupExpenseForm.svelte` (628 — skimmed), `GroupSettleModal`, `GroupBalancePanel`.
- Mobile: `mobile/app/(app)/groups/[id].tsx` 4 tabs (add/balances/history/settings),
  `components/ExpenseForm.tsx`, offline queue (`enqueueOffline`) replays POSTs.

## Findings (round 1)

### F1 — Group ≈ category is the root anti-pattern ⭐ biggest lever
Categories (Food, Housing…) are modeled as separate groups because the expense
account is fixed per member per group (`defaultExpenseAccountId`). Consequences:
- Cross-group netting impossible: balances are scoped to one group. Within a single
  group, netting across expenses ALREADY works (balances sum paid−owed over all
  expenses regardless of "category"). The $100-Housing vs $100-Food problem only
  exists because Housing and Food are different groups.
- N groups × N members `group:<slug>` ledger accounts; settlement friction × N.
- Import flow: picking group = picking category, two concepts squeezed into one select.

Direction: ONE group per household/social unit; category becomes per-expense data.
Options sketched in Recommendations §R1.

### F2 — No cross-currency consolidation
Balances and transfers are per currency. Traveling couple accrues 3-4 currencies →
3-4 transfers at settle time. FX infra exists (`routes/fx-rates.ts`, preferred-currency
epic done). Could offer "consolidate to one currency at settle time" using stored rates
(both parties confirm rate — propose/confirm pattern already exists for settlements).

### F3 — Mobile expense entry is BROKEN on main 🔥
`mobile/components/ExpenseForm.tsx` never sends `paymentAccountId`;
`POST /groups/:id/expenses` 400s without it (`fish-pie-expenses.ts:87`). Use case 2 is
dead in the mobile app right now. Grep confirms zero "paymentAccount" hits in mobile/.
Offline queue replays will also fail silently-ish. NOTE: roadmap lists expense-management
epic as Backlog but its story 3 (required paymentAccountId) is clearly merged — roadmap
stale, mobile never updated. The proposals epic fixes the other-payer case but mobile
needs: account picker (or proposals flow) + status display. Decide whether mobile waits
for proposals epic or gets a hotfix (e.g. backend accepts missing paymentAccountId →
auto-propose-to-self? or mobile sends defaultPaymentAccountId).

### F4 — Import-linked expenses write into partner's ledger silently
Import flow auto-posts the partner's share to THEIR `defaultExpenseAccountId` with no
review/notification (epic says import-linked are always `active`). Acceptable for a
trusting couple but no visibility: no activity feed, no "X added 12 expenses" signal.
Proposals epic covers manual entry only. Gap: arrival notification/feed (see F10).

### F5 — Proposals epic: settlement hard-block may be too blunt
Epic blocks settlement while ANY proposed expense exists (409). One stale proposal
(e.g. duplicate she never confirms) blocks month-end settle. Alternative: proposed
excluded from balances (already the design) + allow settle with warning banner.
Raise with Lester before implementing story 1.

### F6 — `group:` ledger account semantics half-baked (BUG-004a, deferred)
Payer's `group:` never clears after settlement (would unbalance tx). Account is
admittedly cosmetic, but it drifts forever — bad for principle 2 (hledger export
should make sense). If we redesign (F1), revisit: make `group:<slug>` a true
receivable/payable per counterparty? hledger folk model this as
`assets:receivable:partner` / `liabilities:payable:partner`. Worth a design pass.

### F7 — Split-weight UX is confused
- POST /expenses does NOT accept per-expense split overrides; PATCH does
  (`fish-pie-expenses.ts:184` vs POST body type). Creation always uses stored member
  weights.
- Web `GroupExpenseForm` slider appears to mutate GROUP-level weights
  (`onSliderChange` → toast "Split updated", GroupExpenseForm.svelte:124) — changing
  one dinner's split rewrites the default for all future expenses?? VERIFY next round
  (read parent page handler). If true: per-expense split should be per-expense data at
  creation; group weights only a default.
- Import: equal/weights only, no per-row override (epic marked it stretch).

### F8 — hledger export doesn't exist yet
`grep -ril hledger backend/src` → only schema comment. Principle 2 escape hatch
unimplemented. Fish-pie redesign should be informed by what exports cleanly
(member txs already live in each user's ledger — good — but `group:` drift F6 and
`uncategorized` fallbacks will export ugly).

### F9 — Import rules can't auto-flag Fish Pie
Rules prefill `suggestedOffsetAccountId` only. Recurring shared merchants (grocery
store, rent) need manual pie-click every import. Rule action "split with group G
(category C)" = direct hit on use case 1. Check `routes/rules.ts` shape next round.

### F10 — No notification/attention surface
Proposals epic adds "needs attention" section inside one group's page only. Partner
won't know proposals await unless she navigates there. Wanted: cross-group (or
post-F1, cross-section) badge in sidebar/groups list + mobile badge. Mobile TODO
comment in groups/[id].tsx already wants currentUserId from auth context — needed for
any of this.

### F11 — Already-good things (don't break)
- Duplicate detection flags imported rows matching fish-pie settlements with link
  (`ImportRowRegular` fishpie-hint, import.ts:191-217).
- `defaultPaymentAccountId` auto-save on use.
- Greedy debt simplification within group.
- recent-groups sort in GroupSelect.

### F12 — Import-flow UI fragility
Recent branches all fixing GroupSelect portal/anchor/hover regressions (git log:
portal anchor corruption, pill hover camouflage…). Inline-popover-in-table approach is
brittle. If import UX gets reworked for category-choice (F1), consider a sturdier
pattern (e.g. row expands to a config strip instead of floating portal).

## Findings (round 2)

### F13 — Debtor member-tx postings are SIGN-FLIPPED 🔥🔥 (high confidence; write failing test before fixing)
`fish-pie-expense-service.ts` 2-posting member tx (non-payer): `expenses:cat −share /
group:slug +share`. Compare every other path that touches expense accounts:
- import offset (`buildRegularPostings`): expense gets **positive**
- fish-pie payer 3-posting (service ~L112-117 and `buildFishPiePostings`): expense
  share **positive**
Proper double-entry in this codebase's sign language (positive = into account):
debtor should be `expenses:cat +share / group:slug −share` (debt = negative balance).

Two live consequences:
1. **Spending reports wrong for the non-payer.** `reports.ts` sums raw posting
   amounts under `expenses:` root (L77-88 etc). Debtor's fish-pie shares enter as
   NEGATIVE → cancel against their imported spending. Partner's food spending is
   undercounted by exactly her share of every shared expense someone else paid.
2. **BUG-004a is the same bug.** With debtor sign flipped, the EXISTING settlement
   payer leg (`fish-pie-settlements.ts:113`, posts +amt to group:) clears the −share
   balance to zero with NO code change. Receiver side already correct (L177-180).
   004a stops being "deferred redesign" and becomes "fix debtor sign".

Fix shape: flip 2-posting member tx signs; one-off migration flipping historical
member-tx postings (identifiable: `transactions.groupExpenseId IS NOT NULL` AND the
2-posting pattern; payer 3-posting txs must NOT be flipped). Balances endpoint
unaffected (never reads postings). Add spending-report regression test with a
fish-pie debtor share.

### F14 — `uncategorized` fallback is invisible to spending reports
`ensureUncategorizedAccount` path = literal `uncategorized`, outside `expenses:` root
→ shares posted there never appear in any spending view. With categories (R1) this
mostly evaporates, but migration should re-home existing uncategorized postings or at
least surface them.

### F15 — Web "she paid" entry is ALSO broken today
`GroupExpenseForm` always requires `paymentAccountId` (from MY account list);
`POST /expenses` validates account belongs to the PAYER (`fish-pie-expenses.ts:93-97`).
Select partner as payer → 400 "payment account not found or does not belong to payer".
Use case 2 ("I enter what she paid") is dead on web too, not just mobile. Proposals
epic is the precise fix — raises its priority.

### F16 — Rules assessment (why they underwhelm)
`routes/rules.ts` + `routes/import.ts:58-71`:
- Match = case-insensitive **substring of description**, `activeRules.find()` in
  arbitrary DB order → ambiguous precedence when multiple match.
- Mining (`POST /rules/mine`) keys on EXACT full description (lowercased), >2
  occurrences, 2-posting txs only. Bank descriptions vary per visit
  ("LOBLAWS #123" vs "#124") → mining misses most merchants; no normalization/
  tokenization.
- Rule = pattern → one accountId. No amount/account conditions, no actions beyond
  offset prefill, nothing for transfer rows, nothing for fish-pie.
- 3-posting fish-pie payer txs excluded from mining input (length!==2) — after the
  restructure, shared expenses never feed mining.
Import-rules epic sketch: merchant normalization (strip store numbers/dates/cities),
explicit precedence (longest-match or priority int), preview "test against history",
rule actions = {offset account | fish-pie split (group+category) | skip row},
auto-mine after each import instead of manual trigger.

### F17 — Notification/attention infra already half-exists
`actionRequiredStore` (frontend/src/lib/actionRequired.svelte.ts) + sidebar badges,
load-once + invalidate pattern, backed by a bulk summary endpoint. Fish-pie attention
can clone this: `GET /api/fish-pie/attention` → per-group
{settlementsAwaitingMe, proposalsAwaitingMe (post-epic), pendingInvites}.
Surface: sidebar Fish Pie badge + per-group badge + mobile tab badge. Push (Expo)
later; polling-on-navigation good enough now. Notifiable events today: settlement
pending my confirm, invite pending. Future: proposal awaiting me, "partner imported
N shared expenses" (F4), settle-up month-end reminder.

### F18 — Reports/ledger misc (verified)
- `group:` accounts excluded from spending (LIKE `expenses:%`) ✓ no double-count from
  clearing legs.
- Payer's own share counted once ✓ (import 3-posting & manual 3-posting).
- `saveShareSlider` → `updateMemberWeight` ×2 (fish-pie/[id]/+page.svelte:233-240)
  → confirmed group-level weights, per-expense override only via PATCH (edit).

## Flow designs for single-group + per-expense category (R1)

Constraint from Lester: adding category must NOT overload quick entry.

### Schema sketch (option b from R1, refined)
- `groupCategories`: id, groupId, name, sortOrder, archivedAt
- `groupCategoryMemberAccounts`: categoryId, userId, accountId,
  unique(categoryId,userId) — each member maps category → own account once;
  fallback = member.defaultExpenseAccountId, then uncategorized (now flagged, F14)
- `groupExpenses.categoryId` nullable FK (null = legacy/uncategorized)
- OPTIONAL per-category default weights (see migration risk below)
- Keep `expenseGroupMembers.shareWeight` as group default

### Migration risk: per-group weights differ today?
If current category-groups have different splits (Housing 70/30, Food 50/50), a
naive merge loses that. Mitigation: per-category default weights copied from each
old group's weights. ASK LESTER: do any of your groups have different splits?
Also: settlements/expenses re-pointed to merged group; old `group:<slug>` accounts
kept for history, new single clearing/receivable account going forward (combine with
F13 rename — `receivable:<partner>` / `payable:<partner>`?).

### Flow A — category chips with sticky default ⭐ recommended
- Add-expense form (web+mobile): horizontal chip row of categories (like payer
  chips), preselected = last-used (per user per group, store in settings prefs).
  Zero taps when logging several same-category expenses in a row (the "she pays for
  food all day" case); one tap to switch.
- Import row: GroupSelect popover becomes two-step-in-one panel: groups list (most
  cases: exactly one) + category chips inline. Pill shows `🥧 Household · Food`.
  With one group, popover = category list only → SAME tap count as today.
- Expense list/balances: category shown as pill; balances can show per-category
  subtotals (nice "tally up" view for month-end) while netting stays global.

### Flow B — zero-field: infer category from description (layer on A later)
Merchant memory: last category used for this normalized description in this group →
preselect. Needs rules/normalization work (F16) — defer until import-rules epic.
Together A+B ≈ category field that's almost always already right.

### Flow C — keep N groups, add cross-group netting layer (rejected draft)
"Settle all" across groups sharing the same member pair; allocation table for one
settlement covering multiple groups. No migration, but keeps group/category
conflation, N clearing accounts, import picks group-as-category, more code on a
worse model. Keep only if Lester vetoes migration.

## Proposed epic sequencing

1. **fish-pie-ledger-signs** (small, urgent): F13 sign flip + historical migration +
   spending regression tests. Closes BUG-004a. Independent of everything else;
   fixes data that's wrong TODAY. Optionally fold in receivable/payable account
   rename (or defer rename to #2's migration to avoid two account migrations).
2. **fish-pie-categories** (the restructure): schema, merge migration, import-flow
   category picker, form chips, per-category weights. Gates proposals/mobile/rules.
3. **fish-pie-expense-proposals** (existing epic, amended): warn-not-block settle;
   rebase onto categories model.
4. **mobile revival**: payment account, categories, proposals, attention badge.
5. **import-rules-v2** (F16), then fish-pie auto-split rule action (R4).
6. **fish-pie-attention** (F17 notifications).
7. **settle-fx-consolidation** (R5) — can ride along with #3 or #6.
8. **hledger export** — after #1/#2 stabilize semantics.

## Not yet read (next round queue)

- [x] ~~`GroupExpenseForm.svelte` + parent page~~ → F7 confirmed, F15 found
- [x] ~~`routes/import.ts` full read~~ → groupSplits validated up-front, 3 fish-pie
      posting variants (regular/cross-currency/same-currency transfer)
- [x] ~~`routes/rules.ts`~~ → F16
- [x] ~~`routes/reports.ts` double-count question~~ → F13 (worse than double-count:
      sign-flip), F14, F18
- [ ] `GroupRightPanel.svelte` full read (only structure-grepped) — edit/confirm UX
      details before frontend redesign of #2/#3
- [ ] `GroupSettleModal.svelte` + settlement confirm UX end-to-end
- [ ] mobile `ExpenseList/SettleModal/BalanceCard` — parity gaps list (deferred with
      mobile epic anyway)
- [ ] `fish-pie-groups.ts` — group CRUD; where do category endpoints live in #2
- [ ] archived epics `fish-pie-account-integration.md`, `fish-pie-settlement-confirmation.md` — design rationale I skipped
- [ ] verify F13 with a failing test (spending summary w/ debtor share) BEFORE pitching fix PR
- [ ] hledger receivable/payable conventions — verify my sketch against hledger docs
      (plaintextaccounting.org "shared expenses" workflows) when designing #1 rename
- [ ] write epic file drafts for #1 (ledger-signs) and #2 (categories) once Lester
      confirms migration questions

## Open questions for Lester (round 2)

1. **(unanswered from round 1)** How many groups today, all 2-person? Do any have
   different split weights (Housing 70/30 vs Food 50/50)? → decides whether
   categories need per-category default weights in the merge migration.
2. OK to fix F13 (debtor sign flip) as an immediate standalone PR ahead of the
   restructure? It corrects live spending data + closes BUG-004a.
3. Account naming for the ledger pass: keep `group:<name>` or rename to
   `receivable:<partner>` / `payable:<partner>` style (cleaner hledger export)?
   Rename = one more account migration; could bundle with categories migration.
4. Flow A (category chips, sticky last-used) — good enough to green-light epic #2
   drafting?

## Recommendations (draft — refine after next round)

### R1 — Collapse categories into one group ⭐
Single household group; category chosen per expense. Implementation options:
- **a) Per-expense expenseAccount override**: add nullable `expenseAccountId` per split
  (or per expense + per-member mapping). Import row: after picking group, pick
  category from a small list. Member weights stay as default split.
- **b) Group-level category list**: group defines categories ("Food"→ each member maps
  it to their own account once). Expense stores `category`. Cleaner UX (shared
  vocabulary), more schema. PROBABLY THE ONE — preserves "each member's ledger uses
  their own account tree" while giving shared category names.
- Migration: existing groups become categories of one new group; old `group:<slug>`
  accounts retired (or renamed); balances recomputed (they're derived, so safe);
  settlements need group reassignment.
- Payoff: cross-category netting free; one settle per month per currency; import UX
  = pick category not group; sidebar decluttered.

### R2 — Fix mobile entry path (urgent, independent of R1)
Either mobile sends `defaultPaymentAccountId` + account picker, or ship proposals epic
where payer≠self requires no account, and for payer=self mobile must still pick account.
Note epic + mobile must land together or mobile stays broken for self-paid.

### R3 — Proposals epic adjustments before implementing
- Soften settlement block (warn, don't 409) — F5.
- Add `status` badge plumbing to mobile API types too.
- Consider covering "import-linked arrival" visibility (F4/F10) in same epic or a
  follow-up notifications epic.

### R4 — Rule-driven auto-split on import (use case 1 power feature)
Extend import rules with optional groupId(+category post-R1). Recurring shared
merchants auto-pill. Low schema cost, high daily value.

### R5 — Settlement-time FX consolidation (use case "tally at month end")
Offer "settle everything in CAD (or chosen currency)" — converts per-currency nets via
fx-rates at agreed rate, records one settlement + rate note. Both-party confirm already
exists.

### R6 — Ledger semantics cleanup (longer term, with F6/F8)
Decide the canonical export story for shared expenses (receivable/payable model),
fix payer `group:` drift, then build hledger export against it.
