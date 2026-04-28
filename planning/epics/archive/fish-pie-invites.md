# Epic: Fish Pie — Invites

**Goal:** Let a group member invite another registered user by username or email. The invitee sees the pending invite on their Fish Pie page and can accept or decline.

---

## Background

No email is sent. The invite is a record in the DB. The invitee discovers it the next time they visit `/fish-pie`. This is intentional — the app is self-hosted and used by people who already know each other.

Invites are addressed by the invitee's email (which maps to their user account). An invite can only be accepted by the user whose email matches. Once accepted, the user is added to `expenseGroupMembers`.

An invite expires when it is accepted, declined, or the group is deleted. No time-based expiry for now.

---

## Stories

### 1. Invites schema + migration (backend)

Add `expenseGroupInvites` table to `schema.ts`:

- `id` uuid pk
- `groupId` uuid → expenseGroups.id
- `invitedByUserId` uuid → users.id
- `inviteeEmail` text not null (lowercased on insert)
- `status` text not null — `'pending' | 'accepted' | 'declined'`
- `createdAt` timestamp
- `resolvedAt` timestamp (null while pending)
- Unique constraint on `(groupId, inviteeEmail)` where status = 'pending' — enforced at app layer, not DB

Generate and apply migrations (dev + test).

### 2. Invite API (backend)

Routes under `/api/fish-pie/groups/:id/invites`:

- `POST /` — send invite. Body: `{ email }`. Validations: user must be a group member; invitee must not already be a member; no duplicate pending invite. Returns created invite.
- `GET /` — list pending invites for a group. Members only.
- `DELETE /:inviteId` — cancel a pending invite. Only the inviter or group creator can cancel.

Routes under `/api/fish-pie/invites` (current user's inbox):

- `GET /` — list all pending invites addressed to the current user's email.
- `POST /:inviteId/accept` — accept. Adds user to expenseGroupMembers (shareWeight 1). Sets status = 'accepted', resolvedAt = now.
- `POST /:inviteId/decline` — sets status = 'declined', resolvedAt = now.

One smoke test per route.

### 3. Invite UI — group settings (frontend)

On the group detail page (`/fish-pie/[id]`):

- Below the members list, an "Invite" form: email input + "Send invite" button.
- Shows the list of pending invites for the group (email + "Cancel" button).
- On successful invite, pending list updates.

### 4. Invite inbox — Fish Pie home (frontend)

On `/fish-pie`:

- "Pending invites" section above the group list.
- Each invite shows: group name, who invited you, "Accept" and "Decline" buttons.
- On accept: invite disappears, group appears in the group list.
- On decline: invite disappears.
- Section hidden entirely if no pending invites.
