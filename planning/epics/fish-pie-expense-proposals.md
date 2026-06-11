# Epic: Fish Pie — Expense Proposals

**Goal:** When entering an expense paid by another group member, the current user can't know which account that person used. Rather than requiring a guess or blocking entry, expenses where the payer is someone other than the current user enter a **proposed** state. The actual payer reviews and confirms — picking their payment account at that point — and only then do the member transactions get recorded and the expense count toward group balances.

---

## Background

After the expense-management epic, `paymentAccountId` is required on all manual expenses so the payer's source account is properly recorded (3-posting transaction). This works well when you are the payer. But in a 2-person group where entries happen frequently (e.g., partners tracking daily spending), the other person often enters expenses on your behalf — they can't know which account you used.

The settlement flow already uses a propose/confirm pattern: payer initiates, receiver confirms. We adopt the same shape for expenses.

### Proposed expense behaviour

- **Status: `proposed`** — created when `paidByUserId !== currentUserId`
  - No member transactions created yet
  - `paymentAccountId` not required (creator doesn't know it)
  - Does not count toward group balances
  - Settlement is disabled while any proposed expenses exist in the group

- **Status: `active`** — all other cases
  - Member transactions exist
  - Counts toward balances
  - Normal state for self-paid or import-linked expenses

### Who can do what on a proposed expense

| Action | Proposer | Payer | Other members |
|--------|----------|-------|---------------|
| Edit fields (description, amount, date, split) | ✓ | ✓ | ✗ |
| Change payer | ✓ | ✓ | ✗ |
| Confirm (supply payment account → activate) | only if they change payer to themselves | ✓ | ✗ |
| Delete | ✓ | ✓ | ✗ |

If either party edits the payer to be themselves, they must supply `paymentAccountId` and the expense activates immediately.

### Import-linked expenses

Import-linked expenses are always `active` — the import transaction already records the source account. No proposed state applies.

---

## Stories

### 1. Backend — proposed state

**Schema change — `groupExpenses`:**

Add column: `status text NOT NULL DEFAULT 'active'`. Valid values: `'active'` | `'proposed'`.

**`POST /api/fish-pie/groups/:groupId/expenses` changes:**

- If `paidByUserId === currentUserId` → behaviour unchanged (`paymentAccountId` required, `status = 'active'`, member txs created immediately)
- If `paidByUserId !== currentUserId` → `paymentAccountId` not accepted/required, `status = 'proposed'`, no member transactions created

**`PATCH /api/fish-pie/groups/:groupId/expenses/:expenseId` changes:**

Auth: proposer (`createdBy`) or payer (`paidByUserId`) may edit.

- If expense is `proposed` and payer unchanged → update fields, no transactions, remain `proposed`
- If expense is `proposed` and payer changed to current user → require `paymentAccountId`, create member txs, set `status = 'active'`
- If expense is `proposed` and payer changed to a different non-self user → update fields, remain `proposed`
- If expense is `active` → existing PATCH behaviour (existing member txs soft-deleted, recreated)

**`POST /api/fish-pie/groups/:groupId/expenses/:expenseId/confirm`:**

Payer-only endpoint. Activates a proposed expense.

- 403 if `currentUserId !== paidByUserId`
- 409 if already `active`
- Body: `{ paymentAccountId: string }`
- Validates account belongs to current user
- Creates member transactions (same `createMemberTransactionsInTx` path as POST)
- Sets `status = 'active'`
- Auto-saves `defaultPaymentAccountId` if changed

**Balances endpoint:**

Filter `groupExpenses` to `status = 'active'` only. Proposed expenses excluded from net positions and transfers.

**Settlements endpoint — block if pending proposals:**

`POST /groups/:groupId/settlements` → check for any `status = 'proposed'` expenses in the group. If any exist, return `409 { error: 'group has unconfirmed proposed expenses' }`.

**GET groups / expenses — include status:**

`status` field included in all expense responses so the frontend can distinguish proposed vs active.

**Tests:**

- POST with payer = self → `active`, member txs created, `paymentAccountId` required
- POST with payer = other → `proposed`, no txs created, `paymentAccountId` ignored/not required
- GET group → expenses include `status`
- PATCH proposed, no payer change → fields updated, remains `proposed`, no txs
- PATCH proposed, change payer to self → `active`, txs created, `paymentAccountId` required
- PATCH proposed, change payer to another non-self → remains `proposed`
- PATCH by non-proposer, non-payer → 403
- POST confirm → activates, txs created, `paymentAccountId` stored
- POST confirm by non-payer → 403
- POST confirm already active → 409
- Balances: proposed expense excluded from net positions
- Settlement blocked when proposed expenses exist → 409

---

### 2. Frontend — create form & expense list

**Create form (`GroupExpenseForm.svelte`):**

- Payment account field shown only when `paidByUserId === currentUserId` (i.e., "I paid")
- When a different group member is selected as payer: hide the field, show a note below the payer selector: _"[Name] will be asked to confirm this expense and provide their payment account."_
- Submission logic: if payer = self → include `paymentAccountId` (required, block if empty); if payer = other → omit `paymentAccountId`

**Expense list / right panel (`GroupRightPanel.svelte`):**

The expense list is split into two visual sections when relevant:

- **"Needs attention" section** (top, only rendered if non-empty): proposed expenses where `paidByUserId === currentUserId`. These require the current user to confirm. Distinct header (e.g. "Pending your confirmation"), visually separated from the main list.
- **Main list** (below): all other expenses — active expenses and proposed expenses waiting on someone else — in normal date-descending order. Proposed-but-waiting entries show a "Waiting for [Name]" label and a "Pending" badge instead of a confirm button.

When a proposed expense is selected:
- If current user is the payer: show a **"Confirm"** button in the detail view header
- If current user is the proposer (not the payer): show _"Waiting for [Name] to confirm"_ and an Edit button

**Settlement button (group page):**

- If any proposed expenses exist: settlement button is disabled with tooltip _"Confirm all pending expenses first"_

**`frontend/src/lib/api.ts`:**

- `GroupExpense` type: add `status: 'active' | 'proposed'`
- Add `confirmExpense(groupId, expenseId, paymentAccountId)` helper

---

### 3. Frontend — payer confirmation flow

**Confirm flow (triggered from the right panel "Confirm" button):**

Opens an inline form (same area as the edit form) showing:
- Read-only expense summary: description, amount, date, split
- Editable fields: payer can still adjust description, amount, date, split before confirming (calls PATCH then confirm, or a combined confirm endpoint that accepts updated fields)
- **Payment account** field (AccountPathInput, `allowCreate={false}`) pre-filled from `defaultPaymentAccountId`
- "Confirm & record" button → calls `POST /expenses/:id/confirm`
- "Edit instead" link → switches to the full edit form

**On confirm success:**

- Expense transitions to `active` in the list (badge removed)
- Right panel returns to read view

**Editing a proposed expense (Edit button):**

- Edit form for proposer: all fields editable, no payment account field (they're not the payer)
- Edit form for payer: all fields editable + payment account field present; submitting with payment account triggers PATCH with payer = self which activates the expense (no separate confirm step needed)

**Settlement warning:**

- Group page: settlement button shows a `--color-amount-negative` tooltip or inline message instead of just being disabled, explaining why
