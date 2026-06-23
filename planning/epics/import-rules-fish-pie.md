# Epic: Import Rules — Fish Pie splits & inline rule capture

Goal: Make import rules understand Fish Pie splits, and let the user create/refine rules **inline during import** — so a recurring shared merchant (e.g. groceries at BILLA, always split with a partner's group) is auto-split on every future import with zero clicks, and the user builds a direct mental link between "this line on my bank statement" and "this is how it lands in the app."

## Background

Rules today are `(pattern → expense account)` only. They pre-fill `offsetAccountId` during import. They cannot represent a Fish Pie split.

The common real-world flow they miss: a merchant the user **habitually splits** with a group. Example — partner shares groceries; BILLA is always split into their Fish Pie group under the "Groceries" category. Current UX:

1. The rule (if any) pre-fills the expense account in the offset cell.
2. The user must still click the Fish Pie button → pick group → pick category, **every BILLA row, every import.**
3. The moment the split is set, the offset cell swaps to Fish Pie pills and the rule's pre-filled account is discarded (the category drives the expense account). So for a split merchant the rule does no useful work.

Two gaps:

- **Rules can't carry a split.** A merchant you always split can't be remembered as a split.
- **No way to capture a rule from what you just did.** The user categorizes a row (expense account, or a group split) but there's no one-click "remember this" — they have to go to the separate Manage Rules page and re-enter the pattern + target by hand.

This epic closes both. A rule becomes either an **expense-account rule** (existing) or a **Fish Pie split rule** (group + optional category). And every import row gets a "Save as rule" affordance beside the Fish Pie button that persists whatever the user assigned to that row.

---

## Data model

Extend `import_rules` so a rule targets either an expense account **or** a Fish Pie split:

```
import_rules
  id            uuid PK
  userId        → user.id
  pattern       text          -- substring matched against description (case-insensitive)
  accountId     → accounts.id  NULLABLE  -- expense account to pre-fill (expense-account rule)
  groupId       → expense_groups.id  NULLABLE  -- Fish Pie group to split into (split rule)
  categoryId    → group_categories.id NULLABLE -- category within the group; null = uncategorized split
  status        text          -- 'active' | 'suggested' | 'denied'
  matchCount    integer
  createdAt / updatedAt / deletedAt
```

**Invariant:** a rule has exactly one target — either `accountId` set (expense-account rule, `groupId` null) or `groupId` set (split rule, `accountId` null). `categoryId` is only meaningful when `groupId` is set. Enforce in the API; a partial check constraint is optional.

Notes / decisions:
- `accountId` drops its NOT NULL. The `GET /api/rules` join becomes a `leftJoin` on accounts and adds a `leftJoin` on `expense_groups` / `group_categories` so the list can render either kind.
- A split rule does **not** store an expense account — the expense leg is derived from the category at posting-build time (same as a manual split today). This keeps one source of truth for "category → expense account."
- Substring matching is unchanged: still case-insensitive substring of `description`. Split vs expense only changes what gets pre-filled, not how patterns match.

---

## Stories

### 1. Rule schema — optional Fish Pie split target

Backend. Schema + migration + CRUD updates.

- Make `accountId` nullable; add nullable `groupId` (→ `expense_groups`) and `categoryId` (→ `group_categories`) to `importRules` in `schema.ts`. Generate migration; apply to dev **and** test.
- `POST /api/rules` and `PATCH /api/rules/:id`: accept either `{ pattern, accountId }` or `{ pattern, groupId, categoryId? }`. Validate the one-target invariant (exactly one of `accountId` / `groupId`); reject both-set or neither-set with 400. Verify `groupId` / `categoryId` belong to the user.
- `GET /api/rules`: `leftJoin` accounts + groups + categories; return `accountPath`/`accountName` for expense rules and `groupName`/`categoryName` for split rules so the UI can render both.
- Existing endpoints (approve/deny/revive/delete) unchanged.

Tests: create an expense rule and a split rule, fetch both, confirm the right display fields; assert the invariant rejects both-set and neither-set.

---

### 2. Import preview — apply split rules

Backend + Frontend. Make a matched split rule pre-fill the row as a Fish Pie split.

**Backend** (`POST /api/import/preview`, `import.ts`):
- When the matched active rule is a split rule, stamp `suggestedGroupId` (and `suggestedCategoryId`) onto the parsed transaction instead of `suggestedOffsetAccountId`. First matching rule still wins.

**Frontend** (`+page.svelte` rowStates init, `ImportRowRegular.svelte`):
- In the `rowStates` map, if a row has `suggestedGroupId`, initialize `groupId` / `categoryId` from it (and leave `offsetAccountId` at the default). The row renders pre-split via the existing Fish Pie pills branch — zero clicks.
- Add a "Pre-filled by import rule" indicator on the pills (mirror the existing computer-icon tooltip on the offset cell) so an auto-applied split is distinguishable from a manual one.
- User can still remove/change the split (existing × button).

Tests: backend preview test — seed a split rule, preview a CSV with a matching description, assert `suggestedGroupId`/`suggestedCategoryId` on the row. Frontend: verify a pre-split row renders pills and submits as a group split.

---

### 3. Inline "Save as rule" during import  ⭐ core UX

Frontend + a small API helper. A per-row affordance beside the Fish Pie button that persists the row's current assignment as a rule.

**Behavior:**
- New square button in each regular row, next to the Fish Pie button (only when the row has a usable assignment — an `offsetAccountId` or a `groupId`).
- On click, persist a rule derived from the row:
  - row has `groupId` → **split rule** (`groupId` + `categoryId`)
  - else `offsetAccountId` set → **expense-account rule** (`accountId`)
- Pattern defaults to `cleanDescription(tx.description)` (the same normalization mining uses, so it generalizes across store numbers / refs). v1 may save directly with a confirmation toast; a small popover to edit the pattern before saving is a nice-to-have we can layer on after.
- **Re-apply within the current batch:** after saving, apply the new rule to every other not-yet-assigned row in the current preview whose description matches — so saving BILLA once fills the rest of the BILLA rows in this import.
- **State affordance:** the button reflects whether the row is already covered by a rule (pre-existing match, or just-saved) vs. not — e.g. filled/active icon when a rule exists, outline when it doesn't. Saving an already-covered pattern updates the existing rule (upsert by pattern) rather than duplicating.
- Toast on save: e.g. "Rule saved: BILLA → Groceries (Trip group)".

**API:** reuse `POST /api/rules` (now split-aware from story 1). Add a frontend `api.ts` helper if the existing `createRule` signature doesn't cover the split body. Optional convenience: an upsert-by-pattern endpoint if client-side "does a rule already exist" detection proves clumsy.

Tests: component test for the button's two save paths (expense vs split) and the disabled/empty state; the batch re-apply behavior.

---

### 4. Manage Rules UI — show & edit split rules

Frontend. The Manage Rules page (`/import/rules`) currently renders expense rules only.

- Render split rules: show `groupName` (+ `categoryName`) as the target instead of an account path. A small Fish Pie / pie icon distinguishes a split rule from an expense rule at a glance.
- Edit: allow switching a rule's target between an expense account and a group+category (account picker vs group+category picker), reusing the import `GroupSelect` affordance.
- Suggestions section renders split suggestions too (relevant once story 5 lands; harmless before).

Tests: list renders both rule kinds with the right target; editing a rule from expense → split (and back) round-trips.

---

### 5. (Stretch) Mine split rules from history

Backend. Extend `POST /api/rules/mine` to suggest split rules, not just expense rules.

- Detect transactions whose postings include a Fish Pie group/clearing leg, group them by `(normalized description → group + category)`, and suggest split rules above the existing threshold.
- **Hard part:** the group's clearing account is *derived* at import time via `ensureSharedAccount(group)`, not stored on the posting. Mining must map a clearing/receivable posting path back to a `groupId` (reverse the account-path → group derivation, or add a stored linkage). Scope this reverse-mapping first; if it's heavy, land stories 1–4 (which already deliver the BILLA auto-split via the manual inline flow) and treat mining of splits as a follow-up.

Tests: seed Fish Pie transactions for a group, mine, assert a split suggestion with the right group + category + count.

---

## Sequencing

Stories 1 → 2 → 3 deliver the headline win: split rules exist, they auto-apply on import, and the user can capture them inline in one click. Story 4 makes them manageable. Story 5 is an independent, harder add that automates what 3 already lets the user do by hand — defer until the rest is proven in use.
