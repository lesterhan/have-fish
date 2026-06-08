import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroupInvites, expenseGroupMembers, expenseGroups, user } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { ensureSharedAccount } from '../fish-pie-accounts'

const app = new Hono<{ Variables: AppVariables }>()

// POST /api/fish-pie/groups/:id/invites
// Body: { email }
// Validations: user must be member; invitee must not already be member; no duplicate pending invite
app.post('/groups/:id/invites', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const body = await c.req.json<{ email?: string }>()
  const email = body.email?.trim().toLowerCase()
  if (!email) return c.json({ error: 'email is required' }, 400)

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await db
    .select()
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return c.json({ error: 'not found' }, 404)

  const [invitee] = await db.select().from(user).where(eq(user.email, email))
  if (!invitee) return c.json({ error: 'no user with that email' }, 404)

  const alreadyMember = members.some((m) => m.userId === invitee.id)
  if (alreadyMember) return c.json({ error: 'user is already a member' }, 409)

  const existingPending = await db
    .select()
    .from(expenseGroupInvites)
    .where(
      and(
        eq(expenseGroupInvites.groupId, groupId),
        eq(expenseGroupInvites.inviteeEmail, email),
        eq(expenseGroupInvites.status, 'pending'),
      ),
    )
  if (existingPending.length > 0) return c.json({ error: 'invite already pending' }, 409)

  const [invite] = await db
    .insert(expenseGroupInvites)
    .values({ groupId, invitedByUserId: userId, inviteeEmail: email, status: 'pending' })
    .returning()

  return c.json(invite, 201)
})

// GET /api/fish-pie/groups/:id/invites
// List pending invites for the group. Members only.
app.get('/groups/:id/invites', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const [membership] = await db
    .select()
    .from(expenseGroupMembers)
    .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, userId)))
  if (!membership) return c.json({ error: 'not found' }, 404)

  const invites = await db
    .select()
    .from(expenseGroupInvites)
    .where(and(eq(expenseGroupInvites.groupId, groupId), eq(expenseGroupInvites.status, 'pending')))

  return c.json(invites)
})

// DELETE /api/fish-pie/groups/:id/invites/:inviteId
// Cancel a pending invite. Inviter or group creator only.
app.delete('/groups/:id/invites/:inviteId', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const inviteId = c.req.param('inviteId')

  const [invite] = await db
    .select()
    .from(expenseGroupInvites)
    .where(and(eq(expenseGroupInvites.id, inviteId), eq(expenseGroupInvites.groupId, groupId)))
  if (!invite || invite.status !== 'pending') return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, groupId))
  const isInviter = invite.invitedByUserId === userId
  const isCreator = group?.createdBy === userId
  if (!isInviter && !isCreator) return c.json({ error: 'forbidden' }, 403)

  await db.delete(expenseGroupInvites).where(eq(expenseGroupInvites.id, inviteId))

  return new Response(null, { status: 204 })
})

// GET /api/fish-pie/invites
// List all pending invites addressed to the current user's email.
app.get('/invites', async (c) => {
  const userId = c.get('userId')

  const [currentUser] = await db.select().from(user).where(eq(user.id, userId))
  if (!currentUser) return c.json({ error: 'not found' }, 404)

  const invites = await db
    .select({
      id: expenseGroupInvites.id,
      groupId: expenseGroupInvites.groupId,
      invitedByUserId: expenseGroupInvites.invitedByUserId,
      inviteeEmail: expenseGroupInvites.inviteeEmail,
      status: expenseGroupInvites.status,
      createdAt: expenseGroupInvites.createdAt,
      resolvedAt: expenseGroupInvites.resolvedAt,
      groupName: expenseGroups.name,
      inviterName: user.name,
    })
    .from(expenseGroupInvites)
    .innerJoin(expenseGroups, eq(expenseGroupInvites.groupId, expenseGroups.id))
    .innerJoin(user, eq(expenseGroupInvites.invitedByUserId, user.id))
    .where(
      and(
        eq(expenseGroupInvites.inviteeEmail, currentUser.email),
        eq(expenseGroupInvites.status, 'pending'),
        isNull(expenseGroups.deletedAt),
      ),
    )

  return c.json(invites)
})

// POST /api/fish-pie/invites/:inviteId/accept
// Accept invite: add user to expenseGroupMembers, set status = 'accepted'.
app.post('/invites/:inviteId/accept', async (c) => {
  const userId = c.get('userId')
  const inviteId = c.req.param('inviteId')

  const [currentUser] = await db.select().from(user).where(eq(user.id, userId))
  if (!currentUser) return c.json({ error: 'not found' }, 404)

  const [invite] = await db
    .select()
    .from(expenseGroupInvites)
    .where(
      and(
        eq(expenseGroupInvites.id, inviteId),
        eq(expenseGroupInvites.inviteeEmail, currentUser.email),
        eq(expenseGroupInvites.status, 'pending'),
      ),
    )
  if (!invite) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, invite.groupId))

  await db.transaction(async (tx) => {
    await tx
      .insert(expenseGroupMembers)
      .values({ groupId: invite.groupId, userId, shareWeight: 1 })
    await tx
      .update(expenseGroupInvites)
      .set({ status: 'accepted', resolvedAt: new Date() })
      .where(eq(expenseGroupInvites.id, inviteId))
    if (group) await ensureSharedAccount(userId, group, tx)
  })

  const [updated] = await db
    .select()
    .from(expenseGroupInvites)
    .where(eq(expenseGroupInvites.id, inviteId))
  return c.json(updated)
})

// POST /api/fish-pie/invites/:inviteId/decline
// Decline invite: set status = 'declined'.
app.post('/invites/:inviteId/decline', async (c) => {
  const userId = c.get('userId')
  const inviteId = c.req.param('inviteId')

  const [currentUser] = await db.select().from(user).where(eq(user.id, userId))
  if (!currentUser) return c.json({ error: 'not found' }, 404)

  const [invite] = await db
    .select()
    .from(expenseGroupInvites)
    .where(
      and(
        eq(expenseGroupInvites.id, inviteId),
        eq(expenseGroupInvites.inviteeEmail, currentUser.email),
        eq(expenseGroupInvites.status, 'pending'),
      ),
    )
  if (!invite) return c.json({ error: 'not found' }, 404)

  const [updated] = await db
    .update(expenseGroupInvites)
    .set({ status: 'declined', resolvedAt: new Date() })
    .where(eq(expenseGroupInvites.id, inviteId))
    .returning()

  return c.json(updated)
})

export default app
