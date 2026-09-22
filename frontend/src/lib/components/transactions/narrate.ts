// Narration model for TransactionDetail — turns a flat list of role-classified
// postings into a structure that *reads* like what happened, instead of dumping raw
// legs. Pure (no Svelte), so it is exhaustively unit-tested against the canonical
// transaction shapes (see narrate.test.ts).
//
// Roles come from the backend classifier (src/postings/roles.ts), exposed on the GET
// payload. This module only arranges them:
//   - subject   → the meaningful economic legs (the spend / the paycheck). Lead with these.
//   - transfer  → asset↔asset/liability moves. The "how it moved" source + cross-currency flow.
//   - conversion→ FX rate-balancing equity leg. Never shown as a line (it's mechanical noise).
//   - fee       → bank/transfer fee. Shown as a small "fee" line under the movement.
//   - share     → Fish Pie clearing leg. Surfaced as "split with <group>" by the component.

import type { Posting, PostingRole } from '$lib/api'

export type NarratedFlow = {
  from: { amount: string; currency: string }
  to: { amount: string; currency: string }
}

export type NarratedTransaction = {
  // A plain 2-leg transaction (one subject + one transfer, nothing mechanical). The
  // component renders these as a single compact line rather than the full narration.
  simple: boolean
  // The meaningful legs to lead with (expense or income). Amounts are kept signed as
  // stored; the component decides sign presentation.
  subjects: Posting[]
  // Fish Pie clearing legs — rendered as "split with <group>", not a raw receivable line.
  shares: Posting[]
  // The "how it moved" block. Absent (null source + null flow + no fees) when there is
  // nothing mechanical to explain.
  movement: {
    // The origin account (the leg the money came out of). For a plain spend this is the
    // bank/credit account; for a cross-currency move it is the source-currency wallet.
    source: Posting | null
    // Cross-currency flow, e.g. 80 CAD → 50 EUR. Null for same-currency transactions.
    flow: NarratedFlow | null
    // Fee legs (e.g. a Wise fee), shown in plain language under the movement.
    fees: Posting[]
  }
}

function abs(amount: string): string {
  return Math.abs(parseFloat(amount)).toFixed(2)
}

function byRole(postings: Posting[], role: PostingRole): Posting[] {
  return postings.filter((p) => p.role === role)
}

export function narrateTransaction(postings: Posting[]): NarratedTransaction {
  const subjects = byRole(postings, 'subject')
  const shares = byRole(postings, 'share')
  const fees = byRole(postings, 'fee')
  const transfers = byRole(postings, 'transfer')

  // Origin = the most-negative transfer leg (money flowed out of it). Falls back to null
  // when a transaction has no transfer leg (e.g. an opening-balance equity entry).
  const source =
    transfers.length > 0
      ? [...transfers].sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0]
      : null

  // Cross-currency flow exists only when the transfer legs span more than one currency.
  // from = the outflow (source) leg; to = the largest inflow in a *different* currency.
  let flow: NarratedFlow | null = null
  const transferCurrencies = new Set(transfers.map((t) => t.currency))
  if (source && transferCurrencies.size > 1) {
    const inflow = transfers
      .filter((t) => t.currency !== source.currency)
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))[0]
    if (inflow) {
      flow = {
        from: { amount: abs(source.amount), currency: source.currency },
        to: { amount: abs(inflow.amount), currency: inflow.currency },
      }
    }
  }

  // Simple = the common 2-leg case with nothing mechanical to narrate.
  const simple =
    postings.length === 2 &&
    subjects.length === 1 &&
    transfers.length === 1 &&
    shares.length === 0 &&
    fees.length === 0

  return {
    simple,
    subjects,
    shares,
    movement: { source, flow, fees },
  }
}
