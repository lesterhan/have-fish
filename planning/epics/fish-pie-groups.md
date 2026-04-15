# Epic: Fish Pie — Groups & Membership

**Goal:** Let a user create an expense group, name it, and see their groups on the Fish Pie page. Foundation for all Co-op features.

---

## Background

An expense group is a shared ledger between two or more users. One user creates it; others join via invite (covered in the next epic). Every group has a set of members, each with a share ratio that governs how expenses are split by default.

Share ratio is stored as an integer weight, not a percentage — e.g. `[2, 1]` means one member pays 2/3 and the other 1/3. This avoids rounding arithmetic when ratios change.

Groups are soft-deleted (same `deletedAt` convention as the rest of the app).

---

## Stories

### 1. Schema + migrations (backend)

Add two tables to `schema.ts`:

**`expenseGroups`**
- `id` uuid pk
- `name` text not null
- `createdBy` uuid → users.id
- `createdAt` timestamp
- `deletedAt` timestamp (soft delete)

**`expenseGroupMembers`**
- `id` uuid pk
- `groupId` uuid → expenseGroups.id
- `userId` uuid → users.id
- `shareWeight` integer not null default 1
- `joinedAt` timestamp
- Unique constraint on `(groupId, userId)`

Generate and apply migrations (dev + test).

### 2. Groups API (backend)

Routes under `/api/fish-pie/groups`:

- `POST /` — create group. Body: `{ name }`. Auto-adds creator as first member (shareWeight 1). Returns full group + members.
- `GET /` — list groups where the current user is a member (join through expenseGroupMembers). Returns groups with their members.
- `GET /:id` — single group detail with members. 404 if user is not a member.
- `PATCH /:id` — update group name. Creator only.
- `DELETE /:id` — soft-delete. Creator only.

One smoke test per route.

### 3. Fish Pie page — group list + create (frontend)

`/fish-pie` page:

- List all groups the user belongs to. Each group card shows name, member count, and a link to the group detail page.
- "New group" button opens an inline form (not a modal): name input + submit. On success, group appears in list.
- Empty state: friendly message prompting the user to create or join a group.

### 4. Group detail page (frontend)

`/fish-pie/[id]` page:

- Titlebar: group name.
- Members section: list members with their share weights. (Invite UI added in next epic.)
- Placeholder section for expenses (added in Fish Pie — Expenses epic).
- Only accessible to members; redirect to `/fish-pie` if not a member.
