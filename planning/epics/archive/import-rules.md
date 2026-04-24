# Epic: Import Rules (Auto-categorization)

Goal: Let the app learn from existing transactions. Users can mine their transaction history for recurring patterns, store them as rules, and have those rules pre-fill the offset (expense) account during future imports — so only new or unusual transactions need manual categorization.

## Background

After importing several months of bank statements, there is enough historical data to recognize patterns:
- "LOBLAWS #000" always maps to `expenses:food:groceries`
- "PETRO-CANADA" always maps to `expenses:transport:gas`
- "ROGERS" always maps to `expenses:utilities:phone`

Rather than selecting the same expense account dozens of times per import, rules capture these patterns once and apply them automatically. The user can mine suggestions from history, approve or deny them, and manually add/edit/delete rules at any time.

Rules use case-insensitive **substring matching** against `transactions.description`. Amount matching is intentionally excluded — the same merchant appears with different amounts and that's expected.

---

## Data model

```
import_rules
  id            uuid PK
  userId        → user.id
  pattern       text        -- substring matched against description (case-insensitive)
  accountId     → accounts.id  -- the expense account to pre-fill as offsetAccountId
  status        text        -- 'active' | 'suggested'
  matchCount    integer     -- # of existing transactions that triggered this suggestion (informational)
  createdAt     timestamp
  updatedAt     timestamp
  deletedAt     timestamp   -- soft delete; null = active
```

- `status: 'suggested'` = mined, awaiting user action
- `status: 'active'` = confirmed, applied during import preview
- Approving a suggestion flips status to `'active'`
- Denying a suggestion soft-deletes it

---

## Stories

### 1. Rule schema + CRUD API

Backend. Schema + migration + route at `/api/rules`.

- Add `importRules` table to `schema.ts`, generate and apply migrations (dev + test)
- `GET /api/rules` — list all active and suggested rules for the user (join accounts to include `accountPath` for display)
- `POST /api/rules` — create a rule manually (`{ pattern, accountId }`, status defaults to `'active'`)
- `PATCH /api/rules/:id` — update pattern or accountId on an existing rule
- `DELETE /api/rules/:id` — soft delete
- `POST /api/rules/:id/approve` — flip status from `'suggested'` to `'active'`
- `POST /api/rules/:id/deny` — soft delete a suggestion (same as DELETE but semantically distinct)

Sanity test: create a rule, fetch it, confirm it appears.

---

### 2. Mining endpoint

Backend. `POST /api/rules/mine` — analyzes existing transactions and writes suggestions.

**Algorithm:**
1. Fetch all 2-posting transactions for the user (non-deleted). A "2-posting transaction" = one source posting (assets/liabilities account) + one offset posting (expenses account). Identify the expense posting by joining `accounts` and checking that the path starts with the user's `defaultExpensesRootPath` from `userSettings`.
2. Group by `(description, accountId)` pairs. For each group, count how many transactions share the same description + expense account.
3. Only consider groups where `description` is non-null and non-empty.
4. Skip any description already covered by an existing non-deleted rule (active or suggested) — match case-insensitively.
5. For remaining groups, use the full description as the pattern and the most common `accountId` as the target account. Store as `status: 'suggested'` with `matchCount` set.
6. Return `{ created: number }` — how many new suggestions were written.

Sanity test: seed a few transactions with consistent descriptions, call mine, confirm suggestions appear.

---

### 3. Rules page UI

Frontend. New SvelteKit route at `/rules`.

**Layout — three sections:**

**Active rules** (top)
- Table: Pattern | Account | Actions (edit inline, delete)
- "Add rule" opens an inline form row: pattern text input + account picker dropdown + Save
- Editing a rule replaces the row with an inline form

**Suggestions** (middle, hidden when empty)
- Table: Pattern | Suggested account | Match count | Actions (Approve, Deny)
- "Mine suggestions" button at the top of this section — calls `POST /api/rules/mine`, refreshes the list, shows how many new suggestions were created
- Empty state: "No suggestions. Click 'Mine suggestions' to analyze your transaction history."

**Page header**
- Title: "Import Rules"
- Brief explanation: "Rules pre-fill the expense account during import when a transaction description contains the pattern."

Wire up all CRUD actions. No routing away from the page — everything is inline.

---

### 4. Import preview integration

Backend + Frontend.

**Backend** (`POST /api/import/preview`):
- After parsing rows, fetch all `active` rules for the user
- For each parsed transaction with `isTransfer: false`, check if any rule's pattern is a case-insensitive substring of the description
- If matched, attach `suggestedOffsetAccountId: string` to that transaction in the response (first matching rule wins)
- No change to transactions that already have a conflict or are duplicates

**Frontend** (import preview page):
- If a row has `suggestedOffsetAccountId`, pre-fill the "To account" dropdown with that account
- Add a subtle visual indicator (e.g. a small "rule" label or icon) so the user knows the field was auto-filled, not blank
- User can still override the pre-filled account
- Add a "Manage rules" link near the import form header that navigates to `/rules`
