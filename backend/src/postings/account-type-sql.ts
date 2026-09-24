// The SQL half of account-type.ts.
//
// `resolveStoredOrInferredType` answers "what type is this account" for a row already in
// hand. These build the WHERE clause that fetches the rows worth asking about, which is a
// different job with a different contract: the verdict is always the resolver, in JS, and
// the SQL here only keeps a query from scanning the whole ledger to reach it.
//
// So every condition below is allowed to be OVER-inclusive and must never be
// under-inclusive. A route that narrows with one of these still filters the rows it gets
// back. That split is what lets the prefilter stay plain SQL while the answer stays the one
// shared resolver — and it is why these live beside `account-type.ts` rather than inline in a
// route, where each call site would learn the rule slightly differently.
//
// "Cheap" here means the accounts table, not an index: `accounts` has only its primary key, so
// every condition below is a scan of one user's accounts, the same as the LIKE it replaced.

import { and, eq, inArray, isNull, like, not, or, type SQL } from 'drizzle-orm'
import { accounts } from '../db/schema'
import {
  type AccountTypeContext,
  STORED_ACCOUNT_TYPES,
  type StoredAccountType,
} from './account-type'

// `or()` and `and()` type their result as possibly-undefined because they accept zero
// conditions. Every call here passes at least one, and a condition silently dropped would
// widen the selection to the whole ledger, so say what went missing rather than assert it
// away.
export function required(condition: SQL | undefined, what: string): SQL {
  if (!condition) throw new Error(`empty SQL condition: ${what}`)
  return condition
}

/**
 * "At or under this path". The exact-path branch is not decoration: an account created at the
 * bare root (`assets`) is legal, and a `LIKE 'assets:%'` alone would leave it invisible.
 *
 * LIKE metacharacters are escaped here rather than by the caller, and only in the pattern
 * branch. Escaping before the call would be a quiet bug: the escaped string is no longer the
 * account's path, so `expenses:home_office` would match its children and not itself. A path
 * is a value on one side of this and a pattern on the other, and only one of them wants
 * `\_`.
 */
export function underPathCondition(path: string): SQL {
  const pattern = path.replace(/[%_\\]/g, '\\$&')
  return required(or(eq(accounts.path, path), like(accounts.path, `${pattern}:%`)), `under ${path}`)
}

// Inference applies only when the stored column holds nothing usable. A value outside the
// valid set (shouldn't happen — validated on write) also falls back to inference, so treat it
// like null rather than letting the account drop out of the query.
export function noUsableOverrideCondition(): SQL {
  return required(
    or(isNull(accounts.type), not(inArray(accounts.type, [...STORED_ACCOUNT_TYPES]))),
    'no usable override',
  )
}

/**
 * Accounts whose RESOLVED type is one of `types`, over-inclusively.
 *
 * An account matches because it carries that STORED override, or because it carries no usable
 * override and sits at or under something that would hand it that type: a tagged account of
 * that type (inheritance), or a configured root that infers it. Nearest-wins is the resolver's
 * job, not this one's — `expenses:rrsp:tfsa` under a tagged-Asset `expenses:rrsp` matches the
 * expense root branch here and is dropped by the verdict in JS, which is the over-inclusion the
 * contract allows. `cash` and `conversion` have no root, so they reach past the stored column
 * only through a tagged ancestor.
 */
export function typeFilterCondition(
  types: ReadonlySet<StoredAccountType>,
  ctx: AccountTypeContext,
): SQL {
  const branches: SQL[] = [inArray(accounts.type, [...types])]

  // Roots whose inferred type was requested. Only the five inferable types have one.
  const inferableRoots: Partial<Record<StoredAccountType, string>> = {
    asset: ctx.assetsRootPath,
    liability: ctx.liabilitiesRootPath,
    equity: ctx.equityRootPath,
    expense: ctx.expensesRootPath,
    income: ctx.incomeRootPath,
  }
  const wantedRoots = [...types].map((t) => inferableRoots[t]).filter((r): r is string => !!r)
  const wantedTags = [...ctx.tagged].filter(([, type]) => types.has(type)).map(([path]) => path)
  const sources = [...wantedRoots, ...wantedTags]

  if (sources.length > 0) {
    branches.push(
      required(
        and(noUsableOverrideCondition(), or(...sources.map(underPathCondition))),
        'inherited or inferred branch of the type filter',
      ),
    )
  }

  return required(or(...branches), 'type filter')
}

/**
 * Accounts at or under anything that could give an untagged account a type — every configured
 * root and every tagged account. Its negation, beside `noUsableOverrideCondition`, is the
 * over-inclusive half of "unfiled".
 */
export function underAnyTypeSourceCondition(ctx: AccountTypeContext): SQL {
  const sources = [
    ctx.assetsRootPath,
    ctx.liabilitiesRootPath,
    ctx.equityRootPath,
    ctx.expensesRootPath,
    ctx.incomeRootPath,
    ...ctx.tagged.keys(),
  ]
  return required(or(...sources.map(underPathCondition)), 'any type source')
}
