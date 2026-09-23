// Posting role classification.
//
// A posting's ROLE is the job that one leg does inside a single transaction — distinct from
// its account's TYPE (account-type.ts). The same cross-currency Wise spend has five legs of
// four different roles; surfacing the meaningful one and collapsing the mechanical plumbing
// is what makes a complex transaction legible, and what lets the spending sum count each
// spend once instead of double-counting its balancing legs.
//
//   assets:wise:cad  -80 CAD   transfer  ─┐ the account-to-account move
//   assets:wise:eur  +50 EUR   transfer  ─┘
//   equity:conversion …        conversion  the FX rate-balancing leg
//   expenses:banking:fee +…    fee         the Wise fee
//   expenses:food:cafe  -50 EUR subject    the actual spend  ← the one the user cares about
//
// Heuristic by account type + the user's configured fee/conversion accounts. Pure: each
// posting is classified from its own account alone (no sibling context), so this is robust
// to malformed shapes — it never crashes, though it cannot detect that a malformed leg is a
// disguised bridge (that's the heal epic's job).

import {
  type AccountType,
  type AccountTypeRoots,
  resolveStoredOrInferredType,
  toClassifierType,
} from './account-type'

export type PostingRole = 'subject' | 'transfer' | 'conversion' | 'fee' | 'share'

// The minimal posting shape the classifier needs.
export type RolePosting = {
  accountId: string
  accountPath: string
  /**
   * The account's stored hledger type override, straight from `accounts.type`; null when the
   * account carries none and the path is the only thing to go on.
   *
   * Carried on the posting rather than looked up through `ClassifySettings` because it is a
   * property of *this* leg's account, the way `accountPath` is — the settings hold the user's
   * global designations, and an id-to-type map bolted on beside them would be a second place
   * to forget to populate. Required, not optional: a caller that does not supply it is a
   * compile error rather than a leg quietly classified from its path alone.
   */
  accountType: string | null
}

export type ClassifySettings = {
  roots: AccountTypeRoots
  // Accounts explicitly designated as transfer/bank fees (from csvParsers.defaultFeeAccountId).
  feeAccountIds: ReadonlySet<string>
  // Accounts explicitly designated as the FX rate-balancing leg (userSettings.defaultConversionAccountId).
  conversionAccountIds: ReadonlySet<string>
  // The clearing-account namespace whose legs are Fish Pie shares (CLEARING_PREFIX).
  clearingPrefix: string
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}:`)

/**
 * The leg's account type, stored override winning over path inference, collapsed to the
 * coarse five the roles below reason in. Null only when the account is tagged with nothing
 * *and* sits under no configured root — the app genuinely has no answer.
 *
 * Shared by `classifyPosting` and `isExpenseSubject` so the two cannot drift: they used to
 * resolve the type separately, which is how "is this a spend" and "what is this leg" could
 * in principle disagree about the same posting.
 */
function typeOf(p: RolePosting, settings: ClassifySettings): AccountType | null {
  const resolved = resolveStoredOrInferredType(
    { path: p.accountPath, type: p.accountType },
    settings.roots,
  )
  return resolved === null ? null : toClassifierType(resolved)
}

// Classifies one posting. Precedence: explicit account designations (conversion, fee) win
// over the account's own type, because a fee/conversion account lives under the
// expenses/equity root and would otherwise be mistaken for a subject/conversion leg by type
// alone. The designations are about this user's plumbing; the type is about the account.
export function classifyPosting(p: RolePosting, settings: ClassifySettings): PostingRole {
  if (settings.conversionAccountIds.has(p.accountId)) return 'conversion'
  if (settings.feeAccountIds.has(p.accountId)) return 'fee'
  if (under(p.accountPath, settings.clearingPrefix)) return 'share'

  const type = typeOf(p, settings)
  // Untyped and unrooted: the app has no answer, so treat the leg as mechanical rather than
  // guess. A wrong `subject` inflates the spending sum; a wrong `transfer` only under-narrates
  // a row, and the account page says plainly that the account is unfiled. Tagging the account
  // is what resolves it — which is the whole point of the override, and used to be a comment
  // here promising a column that has since landed.
  if (type === null) return 'transfer'
  switch (type) {
    case 'expense':
    case 'income':
      return 'subject'
    case 'equity':
      return 'conversion'
    case 'asset':
    case 'liability':
      return 'transfer'
  }
}

// Classifies a set of postings, keyed by a caller-supplied id (usually posting.id).
export function classifyPostings<T extends RolePosting & { id: string }>(
  postings: T[],
  settings: ClassifySettings,
): Map<string, PostingRole> {
  const out = new Map<string, PostingRole>()
  for (const p of postings) out.set(p.id, classifyPosting(p, settings))
  return out
}

// True when a posting is a genuine spend leg whose account is an expense — the legs that
// make up the spending total. Income subjects (a paycheck) and mechanical legs are excluded.
export function isExpenseSubject(p: RolePosting, settings: ClassifySettings): boolean {
  return classifyPosting(p, settings) === 'subject' && typeOf(p, settings) === 'expense'
}
