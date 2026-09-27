// What an import rule points at. A rule targets exactly one of an expense account or a Fish
// Pie split, optionally with a category inside the group; the two are mutually exclusive,
// so setting one clears the other. Pure: `rule-service.ts` then checks the ids belong to
// the caller.

import { errorBody, type Outcome } from '../errors'

/** The three id fields a request draws a rule's target from. Null clears one. */
export type RuleTargetInput = {
  accountId?: string | null | undefined
  groupId?: string | null | undefined
  categoryId?: string | null | undefined
}

/** The target a request names, before anything is looked up. */
export type RuleTarget =
  | { kind: 'account'; accountId: string }
  | { kind: 'group'; groupId: string; categoryId: string | null }

/** Which target the fields name, or why they name none or two. */
export function readRuleTarget(input: RuleTargetInput): Outcome<RuleTarget> {
  const { accountId, groupId, categoryId } = input

  if (accountId != null && groupId != null) {
    return { ok: false, failure: errorBody('RULE_TARGET_AMBIGUOUS') }
  }
  if (accountId != null) {
    if (categoryId != null) return { ok: false, failure: errorBody('RULE_CATEGORY_WITHOUT_GROUP') }
    return { ok: true, value: { kind: 'account', accountId } }
  }
  if (groupId != null) {
    return { ok: true, value: { kind: 'group', groupId, categoryId: categoryId ?? null } }
  }
  return { ok: false, failure: errorBody('RULE_TARGET_MISSING') }
}

/** Whether a patch names the target at all. A patch that doesn't leaves it as it is. */
export function namesTarget(input: RuleTargetInput): boolean {
  return 'accountId' in input || 'groupId' in input || 'categoryId' in input
}

/** The three columns a target is stored in; the kind it isn't is written as null. */
export function targetColumns(target: RuleTarget) {
  return target.kind === 'account'
    ? { accountId: target.accountId, groupId: null, categoryId: null }
    : { accountId: null, groupId: target.groupId, categoryId: target.categoryId }
}
