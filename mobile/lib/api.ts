/**
 * Typed API client for the have-fish backend.
 * Types mirrored from frontend/src/lib/api.ts — keep in sync when the backend changes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { getBaseUrl, getSession } from './auth'

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

const OFFLINE_QUEUE_KEY = 'havefish_offline_queue'

type QueuedRequest = {
  id: string
  path: string
  method: string
  body?: string
  queuedAt: string
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const [baseUrl, session] = await Promise.all([getBaseUrl(), getSession()])
  if (!baseUrl) throw new Error('No server URL configured')

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (session) headers['Cookie'] = session
  if (options.body) headers['Content-Type'] = 'application/json'

  return fetch(`${baseUrl}${path}`, { ...options, headers })
}

/**
 * Enqueue a mutating request for retry when connectivity is restored.
 * Returns a locally-generated placeholder ID so callers can show optimistic UI.
 */
async function enqueueOffline(path: string, method: string, body?: object): Promise<void> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
  const queue: QueuedRequest[] = raw ? JSON.parse(raw) : []
  queue.push({
    id: Math.random().toString(36).slice(2),
    path,
    method,
    body: body ? JSON.stringify(body) : undefined,
    queuedAt: new Date().toISOString(),
  })
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue))
}

export async function getOfflineQueue(): Promise<QueuedRequest[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
  return raw ? JSON.parse(raw) : []
}

export async function flushOfflineQueue(): Promise<{ flushed: number; failed: number }> {
  // TODO: Iterate queue, re-attempt each request, remove successes, keep failures.
  // Call this from a NetInfo change listener in _layout.tsx when connectivity is restored.
  const queue = await getOfflineQueue()
  let flushed = 0
  let failed = 0
  const remaining: QueuedRequest[] = []

  for (const req of queue) {
    try {
      const res = await apiFetch(req.path, {
        method: req.method,
        body: req.body,
      })
      if (res.ok) {
        flushed++
      } else {
        failed++
        remaining.push(req)
      }
    } catch {
      failed++
      remaining.push(req)
    }
  }

  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining))
  return { flushed, failed }
}

// ---------------------------------------------------------------------------
// Types (mirrored from frontend/src/lib/api.ts — keep in sync with the backend)
// ---------------------------------------------------------------------------

// A ledger account. Mobile only reads the list (to pick a payment/expense
// account); account CRUD stays web-only.
export type Account = {
  id: string
  path: string
  name?: string | null
  defaultCurrency?: string | null
  createdAt?: string
  deletedAt?: string | null
}

export type GroupMember = {
  id: string
  groupId: string
  userId: string
  shareWeight: number
  // Each member's own (private) default accounts for this group. Set on web;
  // mobile reads them to pre-select the payment account on expense entry.
  defaultExpenseAccountId: string | null
  defaultPaymentAccountId: string | null
  joinedAt: string
  userName: string
  userEmail: string
}

// A fish-pie spending category. `myMapping` is the requesting user's own
// account mapping for the category (set on web — mobile assumes it is set and
// only reads it). `weights` is the shared split vector.
export type GroupCategory = {
  id: string
  groupId: string
  name: string
  sortOrder: number
  archivedAt: string | null
  myMapping: { accountId: string } | null
  weights: { userId: string; weight: number }[]
}

export type ExpenseGroup = {
  id: string
  name: string
  defaultCurrency: string | null
  createdBy: string
  createdAt: string
  deletedAt: string | null
  members: GroupMember[]
  categories: GroupCategory[]
}

export type GroupInvite = {
  id: string
  groupId: string
  invitedByUserId: string
  inviteeEmail: string
  status: string
  createdAt: string
  resolvedAt: string | null
  groupName?: string
  inviterName?: string
}

export type ExpenseSplit = {
  id: string
  expenseId: string
  userId: string
  amount: string
  userName: string
  expenseAccountPath: string | null
}

export type GroupExpense = {
  id: string
  groupId: string
  paidByUserId: string
  payerName: string | null
  description: string
  amount: string
  currency: string
  date: string
  transactionId: string | null
  categoryId: string | null
  categoryName: string | null
  createdAt: string
  deletedAt: string | null
  splits: ExpenseSplit[]
}

export type BalanceTransfer = {
  fromUserId: string
  fromUserName: string | null
  toUserId: string
  toUserName: string | null
  amount: string
  currency: string
}

export type CurrencyBalance = {
  currency: string
  netPositions: { userId: string; userName: string | null; amount: string }[]
  transfers: BalanceTransfer[]
}

export type GroupSettlement = {
  id: string
  groupId: string
  fromUserId: string
  fromUserName: string | null
  toUserId: string
  toUserName: string | null
  amount: string
  currency: string
  date: string
  note: string | null
  status: 'pending' | 'completed'
  payerAccountId: string | null
  payerTransactionId: string | null
  receiverTransactionId: string | null
  createdAt: string
  deletedAt: string | null
}

// Everything the group detail screen needs in one round-trip — mirrors the
// backend /groups/:id/overview endpoint, replacing the separate group /
// expenses / balances / settlements / invites fetches.
export type GroupOverview = {
  group: ExpenseGroup
  expenses: GroupExpense[]
  settlements: GroupSettlement[]
  invites: GroupInvite[]
  balances: CurrencyBalance[]
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function fetchAccounts(): Promise<Account[]> {
  const res = await apiFetch('/api/accounts')
  if (!res.ok) throw new Error('Failed to fetch accounts')
  return res.json()
}

// ---------------------------------------------------------------------------
// Group management
// ---------------------------------------------------------------------------

export async function fetchGroups(): Promise<ExpenseGroup[]> {
  const res = await apiFetch('/api/fish-pie/groups')
  if (!res.ok) throw new Error('Failed to fetch groups')
  return res.json()
}

export async function fetchGroup(id: string): Promise<ExpenseGroup> {
  const res = await apiFetch(`/api/fish-pie/groups/${id}`)
  if (!res.ok) throw new Error('Group not found')
  return res.json()
}

export async function fetchGroupOverview(groupId: string): Promise<GroupOverview> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/overview`)
  if (!res.ok) throw new Error('Failed to load group')
  return res.json()
}

export async function createGroup(name: string): Promise<ExpenseGroup> {
  const res = await apiFetch('/api/fish-pie/groups', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create group')
  return res.json()
}

export async function updateGroup(
  id: string,
  data: { name?: string; defaultCurrency?: string | null },
): Promise<ExpenseGroup> {
  const res = await apiFetch(`/api/fish-pie/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update group')
  return res.json()
}

export async function updateMemberWeight(
  groupId: string,
  userId: string,
  shareWeight: number,
): Promise<GroupMember> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ shareWeight }),
  })
  if (!res.ok) throw new Error('Failed to update share weight')
  return res.json()
}

export async function deleteGroup(id: string): Promise<void> {
  const res = await apiFetch(`/api/fish-pie/groups/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete group')
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function fetchGroupInvites(groupId: string): Promise<GroupInvite[]> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/invites`)
  if (!res.ok) throw new Error('Failed to fetch invites')
  return res.json()
}

export async function sendInvite(groupId: string, email: string): Promise<GroupInvite> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to send invite')
  }
  return res.json()
}

export async function cancelInvite(groupId: string, inviteId: string): Promise<void> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/invites/${inviteId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to cancel invite')
}

export async function fetchMyInvites(): Promise<GroupInvite[]> {
  const res = await apiFetch('/api/fish-pie/invites')
  if (!res.ok) throw new Error('Failed to fetch invites')
  return res.json()
}

export async function acceptInvite(inviteId: string): Promise<GroupInvite> {
  const res = await apiFetch(`/api/fish-pie/invites/${inviteId}/accept`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to accept invite')
  return res.json()
}

export async function declineInvite(inviteId: string): Promise<GroupInvite> {
  const res = await apiFetch(`/api/fish-pie/invites/${inviteId}/decline`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to decline invite')
  return res.json()
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export async function fetchExpenses(groupId: string): Promise<GroupExpense[]> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/expenses`)
  if (!res.ok) throw new Error('Failed to fetch expenses')
  return res.json()
}

export async function createExpense(
  groupId: string,
  // paymentAccountId is required by the backend (the asset/liability account the
  // payer fronted the money from); the backend also persists it as the payer's
  // sticky default for the group. categoryId is optional — when set, splits are
  // booked against each member's mapped expense account for that category.
  body: {
    description: string
    amount: string
    currency: string
    date: string
    paidByUserId?: string
    paymentAccountId: string
    categoryId?: string | null
  },
): Promise<GroupExpense> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/expenses`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // Queue for retry if offline, then surface the error
    await enqueueOffline(`/api/fish-pie/groups/${groupId}/expenses`, 'POST', body)
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to create expense')
  }
  return res.json()
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  body: {
    description?: string
    amount?: string
    currency?: string
    date?: string
    paidByUserId?: string
    paymentAccountId?: string
    categoryId?: string | null
  },
): Promise<GroupExpense> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/expenses/${expenseId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to update expense')
  }
  return res.json()
}

export async function deleteExpense(groupId: string, expenseId: string): Promise<void> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/expenses/${expenseId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete expense')
}

// ---------------------------------------------------------------------------
// Balances & Settlements
// ---------------------------------------------------------------------------

export async function fetchBalances(groupId: string): Promise<CurrencyBalance[]> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/balances`)
  if (!res.ok) throw new Error('Failed to fetch balances')
  return res.json()
}

export async function fetchSettlements(groupId: string): Promise<GroupSettlement[]> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/settlements`)
  if (!res.ok) throw new Error('Failed to fetch settlements')
  return res.json()
}

export async function createSettlement(
  groupId: string,
  // payerAccountId (required) is the payer's account the money leaves from. The
  // settlement is created `pending` until the receiver confirms it.
  body: {
    fromUserId: string
    toUserId: string
    amount: string
    currency: string
    date: string
    note?: string
    payerAccountId: string
  },
): Promise<GroupSettlement> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/settlements`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to create settlement')
  }
  return res.json()
}

// Receiver-side confirmation of a pending settlement — books the receiving leg
// against receiverAccountId and flips status to `completed`. (Settlement UI is
// deferred past MVP; the client method is here so the contract is complete.)
export async function confirmSettlement(
  groupId: string,
  settlementId: string,
  receiverAccountId: string,
): Promise<GroupSettlement> {
  const res = await apiFetch(
    `/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ receiverAccountId }),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to confirm settlement')
  }
  return res.json()
}

export async function deleteSettlement(groupId: string, settlementId: string): Promise<void> {
  const res = await apiFetch(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete settlement')
}
