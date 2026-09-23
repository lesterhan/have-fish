// The SQL half of account-type.ts.
//
// `resolveStoredOrInferredType` answers "what type is this account" for a row already in
// hand. These build the WHERE clause that fetches the rows worth asking about, which is a
// different job with a different contract: the verdict is always the resolver, in JS, and
// the SQL here only keeps a query from scanning the whole ledger to reach it.
//
// So every condition below is allowed to be OVER-inclusive and must never be
// under-inclusive. A route that narrows with one of these still filters the rows it gets
// back. That split is what lets the prefilter stay a cheap indexed lookup while the answer
// stays the one shared resolver — and it is why these live beside `account-type.ts` rather
// than inline in a route, where the four call sites would each learn the rule slightly
// differently.

import { and, eq, inArray, isNull, like, not, or, type SQL } from 'drizzle-orm'
import { accounts } from '../db/schema'
import { type AccountTypeRoots, STORED_ACCOUNT_TYPES, type StoredAccountType } from './account-type'

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
 * An account matches either because it carries that STORED override, or because it carries
 * no usable override and its PATH infers to it. `cash` and `conversion` are override-only —
 * inference never produces them — so they contribute no path branch at all, which is what
 * makes asking for Cash alone a cheap indexed lookup rather than a full scan.
 */
export function typeFilterCondition(
  types: ReadonlySet<StoredAccountType>,
  roots: AccountTypeRoots,
): SQL {
  const branches: SQL[] = [inArray(accounts.type, [...types])]

  // Roots whose inferred type was requested. Only the five inferable types have one.
  const inferableRoots: Partial<Record<StoredAccountType, string>> = {
    asset: roots.assetsRootPath,
    liability: roots.liabilitiesRootPath,
    equity: roots.equityRootPath,
    expense: roots.expensesRootPath,
    income: roots.incomeRootPath,
  }
  const wantedRoots = [...types].map((t) => inferableRoots[t]).filter((r): r is string => !!r)

  if (wantedRoots.length > 0) {
    const underWantedRoot = wantedRoots.map(underPathCondition)
    branches.push(
      required(
        and(noUsableOverrideCondition(), or(...underWantedRoot)),
        'inferred branch of the type filter',
      ),
    )
  }

  return required(or(...branches), 'type filter')
}
