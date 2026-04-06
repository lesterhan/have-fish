# Epic: Single Account View

A dedicated page for a single account that shows its transaction history.
This is the destination when the user clicks an account row in the sidebar.

## Goals

- Route `/account/[id]` renders a page scoped to one account
- Account path shown as the page heading
- Lists all transactions for that account in reverse chronological order
- Sidebar account rows link to this page
- Accounts can optionally have a human-friendly `name` separate from their path

## Stories

### Story 1 — Add optional `name` field to accounts

Add a nullable `name` column to the `accounts` table.

**Backend:**
- `schema.ts`: add `name: text('name')` (nullable, no default) to the `accounts` table
- Run `db:generate` to produce the migration, then `db:migrate` and `db:migrate:test`
- `routes/accounts.ts`: include `name` in GET responses; accept `name` in the PATCH body

**Frontend:**
- `api.ts`: add `name?: string` to the `Account` type

---

### Story 2 — `/account/[id]` route (skeleton)

Create the route and wire up data loading.

**Backend:**
- `GET /api/accounts/:id` — return a single account's full record (id, path, name, createdAt).
  Auth-guard and 404 if the account doesn't belong to the user.

**Frontend:**
- `src/routes/(authed)/account/[id]/+page.ts` — load function: fetch the account by id and its
  transactions using the existing `GET /api/transactions?accountId=:id` endpoint (already
  supports per-account filtering), ordered newest-first.
- `src/routes/(authed)/account/[id]/+page.svelte` — skeleton: heading shows `account.name ?? account.path`,
  then a `<TransactionRow>` list identical in structure to the transactions page.

---

### Story 3 — Link sidebar account rows

Update `Sidebar.svelte` so each account row is an `<a>` linking to `/account/[id]`.

The sidebar currently only has `path` and `balances` per account — confirm the
`AccountBalance` type also carries `id` (check `GET /api/accounts/balances` response),
and if not, add it.

---
