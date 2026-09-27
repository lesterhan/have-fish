// Import rules: a description pattern and the account or Fish Pie split it maps to. The
// preview applies active rules (`import/preview`); this file is how they are listed, made,
// mined, changed and retired. What a target may be is in `target.ts`, mining in `mining.ts`.

import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import {
  accounts,
  expenseGroupMembers,
  expenseGroups,
  groupCategories,
  importRules,
  postings,
  transactions,
} from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import { loadClassifySettings } from '../postings/classify-service'
import type { RolePosting } from '../postings/roles'
import { mineSuggestions } from './mining'
import { type RuleTarget, type RuleTargetInput, readRuleTarget, targetColumns } from './target'

type RuleRow = typeof importRules.$inferSelect
type RuleStatus = 'active' | 'suggested' | 'denied'
type TargetColumns = ReturnType<typeof targetColumns>

const ruleNotFound = { ok: false, failure: errorBody('RULE_NOT_FOUND') } as const

// Every id in a target must be the caller's to point at.
async function checkTarget(userId: string, target: RuleTarget): Promise<Outcome<TargetColumns>> {
  if (target.kind === 'account') {
    if (!(await accountsOwnedBy(userId, [target.accountId]))) {
      return { ok: false, failure: errorBody('ACCOUNT_NOT_FOUND') }
    }
    return { ok: true, value: targetColumns(target) }
  }

  // The rule may only target a group the user is actually in — otherwise an import
  // could post into a stranger's shared ledger.
  const [membership] = await db
    .select({ id: expenseGroupMembers.id })
    .from(expenseGroupMembers)
    .innerJoin(expenseGroups, eq(expenseGroups.id, expenseGroupMembers.groupId))
    .where(
      and(
        eq(expenseGroupMembers.groupId, target.groupId),
        eq(expenseGroupMembers.userId, userId),
        isNull(expenseGroups.deletedAt),
      ),
    )
  if (!membership) return { ok: false, failure: errorBody('NOT_A_GROUP_MEMBER') }
  if (target.categoryId === null) return { ok: true, value: targetColumns(target) }

  // A category is only meaningful inside its own group, and an archived one would
  // produce expenses the user can no longer categorize by hand.
  const [category] = await db
    .select({ id: groupCategories.id, archivedAt: groupCategories.archivedAt })
    .from(groupCategories)
    .where(
      and(eq(groupCategories.id, target.categoryId), eq(groupCategories.groupId, target.groupId)),
    )
  if (!category) return { ok: false, failure: errorBody('CATEGORY_NOT_IN_GROUP') }
  if (category.archivedAt) return { ok: false, failure: errorBody('CATEGORY_ARCHIVED') }
  return { ok: true, value: targetColumns(target) }
}

// The target a request names, checked, as the columns to write.
async function resolveTarget(
  userId: string,
  input: RuleTargetInput,
): Promise<Outcome<TargetColumns>> {
  const target = readRuleTarget(input)
  if (!target.ok) return target
  return checkTarget(userId, target.value)
}

/**
 * Every live rule (active, suggested and denied), with the display fields for whichever
 * target kind each uses. Left joins throughout: a rule has exactly one target, so the
 * columns for the other kind are always null.
 */
export async function listRules(userId: string) {
  return db
    .select({
      id: importRules.id,
      pattern: importRules.pattern,
      accountId: importRules.accountId,
      accountPath: accounts.path,
      accountName: accounts.name,
      groupId: importRules.groupId,
      groupName: expenseGroups.name,
      categoryId: importRules.categoryId,
      categoryName: groupCategories.name,
      status: importRules.status,
      matchCount: importRules.matchCount,
      createdAt: importRules.createdAt,
      updatedAt: importRules.updatedAt,
    })
    .from(importRules)
    .leftJoin(accounts, eq(importRules.accountId, accounts.id))
    .leftJoin(expenseGroups, eq(importRules.groupId, expenseGroups.id))
    .leftJoin(groupCategories, eq(importRules.categoryId, groupCategories.id))
    .where(and(eq(importRules.userId, userId), isNull(importRules.deletedAt)))
}

/** Make an active rule by hand. */
export async function createRule(
  userId: string,
  input: { pattern: string } & RuleTargetInput,
): Promise<Outcome<RuleRow>> {
  const target = await resolveTarget(userId, input)
  if (!target.ok) return target
  const created = await db
    .insert(importRules)
    .values({ userId, pattern: input.pattern, ...target.value, status: 'active' })
    .returning()
  return { ok: true, value: returnedRow(created, 'insert import_rules') }
}

/**
 * Write a 'suggested' rule for each pattern `mineSuggestions` finds in the caller's ledger,
 * skipping patterns any live rule already covers (denied ones included, so a denial sticks).
 * Answers how many were written.
 */
export async function mineRules(userId: string): Promise<{ created: number }> {
  const settings = await loadClassifySettings(userId)

  // Every live posting on a live transaction, with the account's path and stored type.
  const rows = await db
    .select({
      txId: transactions.id,
      description: transactions.description,
      accountId: postings.accountId,
      accountPath: accounts.path,
      accountType: accounts.type,
    })
    .from(transactions)
    .innerJoin(
      postings,
      and(eq(postings.transactionId, transactions.id), isNull(postings.deletedAt)),
    )
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))

  const byTx = new Map<string, { description: string | null; postings: RolePosting[] }>()
  for (const { txId, description, ...leg } of rows) {
    const tx = byTx.get(txId) ?? { description, postings: [] }
    tx.postings.push(leg)
    byTx.set(txId, tx)
  }

  const existing = await db
    .select({ pattern: importRules.pattern })
    .from(importRules)
    .where(and(eq(importRules.userId, userId), isNull(importRules.deletedAt)))
  const covered = new Set(existing.map((r) => r.pattern.toLowerCase()))

  const suggestions = mineSuggestions(byTx.values(), settings, covered)
  if (suggestions.length > 0) {
    await db.insert(importRules).values(
      suggestions.map((s) => ({
        userId,
        pattern: s.pattern,
        accountId: s.accountId,
        status: 'suggested' as const,
        matchCount: s.count,
      })),
    )
  }
  return { created: suggestions.length }
}

/**
 * Change a rule's pattern, target, or both. The caller has checked the patch names at least
 * one of them. The target is replaced wholesale, never merged: sending accountId on a split
 * rule clears groupId and categoryId, and vice versa. Merging would let a partial patch leave
 * a rule with both targets set, which is the one state the model forbids.
 */
export async function updateRule(
  userId: string,
  ruleId: string,
  patch: { pattern?: string | undefined; target?: RuleTargetInput | undefined },
): Promise<Outcome<RuleRow>> {
  const set: Partial<Pick<RuleRow, 'pattern'> & TargetColumns> = {}
  if (patch.pattern !== undefined) set.pattern = patch.pattern
  if (patch.target) {
    const target = await resolveTarget(userId, patch.target)
    if (!target.ok) return target
    Object.assign(set, target.value)
  }

  const [updated] = await db
    .update(importRules)
    .set(set)
    .where(liveRule(userId, ruleId))
    .returning()
  return updated ? { ok: true, value: updated } : ruleNotFound
}

/** Soft-delete a rule. Deleting one that is gone, or someone else's, changes nothing. */
export async function deleteRule(userId: string, ruleId: string): Promise<void> {
  await db.update(importRules).set({ deletedAt: new Date() }).where(liveRule(userId, ruleId))
}

/**
 * The moves a rule's status can make:
 * - approve: any rule becomes active;
 * - deny: a suggestion becomes denied. The row is kept, not deleted, so its pattern stays in
 *   mining's skip-set and is never suggested again;
 * - revive: a denied rule becomes a suggestion again.
 */
const TRANSITIONS = {
  approve: { from: null, to: 'active' },
  deny: { from: 'suggested', to: 'denied' },
  revive: { from: 'denied', to: 'suggested' },
} as const satisfies Record<string, { from: RuleStatus | null; to: RuleStatus }>

export type RuleTransition = keyof typeof TRANSITIONS

/** Make one of the moves above, or RULE_NOT_FOUND when the rule is gone or not in the right state. */
export async function moveRule(
  userId: string,
  ruleId: string,
  move: RuleTransition,
): Promise<Outcome<RuleRow>> {
  const { from, to } = TRANSITIONS[move]
  const [updated] = await db
    .update(importRules)
    .set({ status: to })
    .where(liveRule(userId, ruleId, from === null ? undefined : eq(importRules.status, from)))
    .returning()
  return updated ? { ok: true, value: updated } : ruleNotFound
}

function liveRule(userId: string, ruleId: string, extra?: SQL): SQL | undefined {
  return and(
    eq(importRules.id, ruleId),
    eq(importRules.userId, userId),
    extra,
    isNull(importRules.deletedAt),
  )
}
