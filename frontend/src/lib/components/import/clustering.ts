import type { ParsedTransaction } from '$lib/api'
import type { RowState, RowSource } from './row-state'

// Merchant clusters for the Sort step.
//
// Sort and Review are different modes of thinking, so they get different shapes.
// "LOBLAWS is always groceries" has no date attached, so clusters are ordered by how much
// work they save (count descending) rather than chronologically. Review stays strictly
// chronological; nothing here reorders it.

export type MerchantCluster = {
  key: string // the merchant stem, shared by every member
  indices: number[] // row indices, in date order
  firstDate: string
  lastDate: string
  // Summed spend-facing amount, or null when members span several currencies — adding
  // 40 EUR to 40 CAD would be a made-up number.
  total: number | null
  currency: string | null
  // The active rule already covering this cluster, if any. Shown rather than hidden: a
  // wrong rule the user can't see is worse than one more row to read.
  matchedRulePattern: string | null
}

// The user's decisions for one cluster. Serialized into the import session.
export type ClusterState = {
  key: string
  accountId: string
  groupId: string | null
  categoryId: string | null
  // Writes an active import rule from the stem and target on apply.
  remember: boolean
  // Member row indices peeled out of the bulk assign ("that BILLA was a gift").
  excluded: number[]
}

// The amount a cluster sums, per row kind: what was actually spent.
function spendFacing(tx: ParsedTransaction, defaultCurrency: string): { amount: number; currency: string } {
  if (tx.isTransfer === true) {
    return { amount: Math.abs(parseFloat(tx.targetAmount)), currency: tx.targetCurrency }
  }
  if (tx.isTransfer === 'same-currency') {
    return { amount: Math.abs(parseFloat(tx.amount)), currency: tx.currency }
  }
  return { amount: Math.abs(parseFloat(tx.amount)), currency: tx.currency ?? defaultCurrency }
}

// Clusters of two or more rows sharing a merchant stem, biggest first. Singletons are left
// out — there is no bulk in a bulk assign of one, and Review handles them in context.
export function buildClusters(
  transactions: ParsedTransaction[],
  defaultCurrency: string,
): MerchantCluster[] {
  const byKey = new Map<string, number[]>()
  transactions.forEach((tx, i) => {
    const key = tx.merchantKey
    if (!key) return
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(i)
  })

  const clusters: MerchantCluster[] = []
  for (const [key, indices] of byKey) {
    if (indices.length < 2) continue

    const ordered = [...indices].sort((a, b) =>
      (transactions[a].date ?? '').localeCompare(transactions[b].date ?? ''),
    )

    const amounts = ordered.map((i) => spendFacing(transactions[i], defaultCurrency))
    const currencies = new Set(amounts.map((a) => a.currency))
    const singleCurrency = currencies.size === 1 ? [...currencies][0] : null

    clusters.push({
      key,
      indices: ordered,
      firstDate: (transactions[ordered[0]].date ?? '').slice(0, 10),
      lastDate: (transactions[ordered[ordered.length - 1]].date ?? '').slice(0, 10),
      total: singleCurrency ? amounts.reduce((sum, a) => sum + a.amount, 0) : null,
      currency: singleCurrency,
      matchedRulePattern:
        ordered.map((i) => transactions[i].matchedRulePattern).find(Boolean) ?? null,
    })
  }

  // Count descending, then alphabetically so the order is stable across re-renders.
  return clusters.sort((a, b) => b.indices.length - a.indices.length || a.key.localeCompare(b.key))
}

// `remember` defaults on for a cluster of three or more and off for a pair. Three is where
// a merchant looks like a habit rather than a coincidence; a pair is often two unrelated
// charges that happen to share a stem.
export const REMEMBER_THRESHOLD = 3

export function initialClusterState(cluster: MerchantCluster): ClusterState {
  return {
    key: cluster.key,
    accountId: '',
    groupId: null,
    categoryId: null,
    // A cluster a rule already covers defaults to off however large it is — the user is
    // overriding an existing rule here, and remembering would write a second rule with the
    // same pattern rather than correcting the one that fired. They can still turn it on.
    remember: !cluster.matchedRulePattern && cluster.indices.length >= REMEMBER_THRESHOLD,
    excluded: [],
  }
}

// Where a cluster sends its rows. Exactly one kind, mirroring an import rule's target.
export type RowTarget =
  | { kind: 'account'; accountId: string }
  | { kind: 'split'; groupId: string; categoryId: string | null }

export function clusterTarget(state: ClusterState): RowTarget | null {
  if (state.groupId) return { kind: 'split', groupId: state.groupId, categoryId: state.categoryId }
  if (state.accountId) return { kind: 'account', accountId: state.accountId }
  return null
}

// Applies a target to one row, choosing the field the row's kind actually commits from.
// Shared by the Sort step's bulk assign and Review's save-as-rule back-fill, so the two
// can't drift into writing different fields for the same decision.
export function applyTarget(
  tx: ParsedTransaction,
  row: RowState,
  target: RowTarget,
  source: RowSource,
): RowState {
  if (target.kind === 'split') {
    return { ...row, groupId: target.groupId, categoryId: target.categoryId, source }
  }
  // A cross-currency spend posts to its expense account; every other row to its offset.
  if (tx.isTransfer === true) {
    return { ...row, expenseAccountId: target.accountId, groupId: null, categoryId: null, source }
  }
  return { ...row, offsetAccountId: target.accountId, groupId: null, categoryId: null, source }
}

// Member rows a bulk assign would write.
//
// Without `override`, rows the user already decided on are left alone — walking
// Review → Sort → Review must not stomp hand edits. With it, the cluster wins.
export function membersToWrite(
  cluster: MerchantCluster,
  state: ClusterState,
  rowStates: RowState[],
  override: boolean,
): number[] {
  return cluster.indices.filter((i) => {
    if (state.excluded.includes(i)) return false
    const row = rowStates[i]
    if (!row || row.skipped) return false
    return override || row.source !== 'user'
  })
}

// How many members of this cluster the user has already decided on by hand — what the
// "override all N" affordance is counting.
export function userEditedCount(
  cluster: MerchantCluster,
  state: ClusterState,
  rowStates: RowState[],
): number {
  return cluster.indices.filter(
    (i) => !state.excluded.includes(i) && rowStates[i]?.source === 'user' && !rowStates[i].skipped,
  ).length
}
