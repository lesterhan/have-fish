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

import { resolveAccountType, type AccountTypeRoots } from './account-type'

export type PostingRole = 'subject' | 'transfer' | 'conversion' | 'fee' | 'share'

// The minimal posting shape the classifier needs.
export type RolePosting = {
  accountId: string
  accountPath: string
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

// Classifies one posting. Precedence: explicit account designations (conversion, fee) win
// over path-based inference, because a fee/conversion account lives under the expenses/equity
// root and would otherwise be mistaken for a subject/conversion leg by type alone.
export function classifyPosting(p: RolePosting, settings: ClassifySettings): PostingRole {
  if (settings.conversionAccountIds.has(p.accountId)) return 'conversion'
  if (settings.feeAccountIds.has(p.accountId)) return 'fee'
  if (under(p.accountPath, settings.clearingPrefix)) return 'share'

  const type = resolveAccountType(p.accountPath, settings.roots)
  switch (type) {
    case 'expense':
    case 'income':
      return 'subject'
    case 'equity':
      return 'conversion'
    case 'asset':
    case 'liability':
      return 'transfer'
    default:
      // Unknown (atypically-named) root. Treat as mechanical so it never inflates the
      // spending sum — matches today's behaviour, where only paths under the expenses root
      // are summed. A stored type column will let these be classified correctly later.
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
  return (
    classifyPosting(p, settings) === 'subject' &&
    resolveAccountType(p.accountPath, settings.roots) === 'expense'
  )
}
