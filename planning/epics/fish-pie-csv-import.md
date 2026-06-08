# Epic: Fish Pie — CSV Import Integration

**Goal:** Let users flag line items during CSV import as shared group expenses, so bulk expense splitting happens at import time rather than requiring manual re-entry in Fish Pie.

---

## Background

The CSV import flow currently reviews rows, applies import rules, assigns expense accounts, and creates transactions. This epic adds a "split with group" action on individual rows during the review step.

When a row is flagged for a group:
- The imported transaction is created as normal (it posts to the user's accounts).
- A group expense is created and linked to that transaction (`groupExpenses.transactionId`).
- Member shares are auto-posted to each member's default expense account — same logic as Story 3 of Account Integration.
- The importing user is recorded as `paidByUserId` (they paid — it came from their account).

**Dependency:** requires Fish Pie — Account Integration to be complete (auto-posting logic, `shared:<group>` accounts, `transactionId` link on `groupExpenses`).

---

## Stories

### 1. Group-split flag on import rows (frontend)

In the CSV import review table, each row gets a "Split with group" action (icon button or right-click context menu — match the existing UX pattern for row actions).

Clicking opens an inline popover/panel per row:
- Group selector: lists groups the user is a member of.
- Split ratio: defaults to equal (based on member weights). Allow overriding per-member amount if needed (stretch — skip for now, equal split is enough).
- Confirm: row gets a "split" badge showing the group name.

Multiple rows can be flagged before submitting the import.

### 2. Backend: accept group split on import (backend)

The import submission endpoint (`POST /api/import` or equivalent) accepts an optional `groupSplits` array alongside the row data:

```ts
groupSplits?: Array<{
  rowIndex: number       // which import row
  groupId: string        // group to add the expense to
}>
```

For each flagged row, after creating the transaction:
- Call the group expense creation logic (same as `POST /api/fish-pie/groups/:id/expenses`) with the transaction's description, amount, currency, date, and `paidByUserId = currentUser`.
- Link `groupExpenses.transactionId` to the newly created transaction.
- Auto-post shares to each member's default expense account.

This reuses the existing expense-creation logic without duplication — extract it into a shared service function if not already.

Tests:
- Import with group split creates transaction + group expense + postings.
- Row without split creates transaction only (existing behaviour unchanged).
- Group the user is not a member of → 403.

### 3. Split badge + review (frontend)

In the import review table:
- Flagged rows show a pill/badge: "Split: [group name]".
- Clicking the badge re-opens the popover to edit or remove the split before submission.
- Split rows show a small indicator in the amount column (e.g. a fork icon) to signal the amount will be divided.

After import completes:
- Success summary shows "X transactions imported, Y added to Fish Pie groups."
- Groups that received expenses have their expense lists updated.
