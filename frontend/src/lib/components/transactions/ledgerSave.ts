// Ledger-edit save plan: what the raw posting editor (LedgerEditModal) sends when the user
// presses Save.
//
// A transaction's postings are saved as one set, through replacePostings, never one leg at
// a time. The backend validates the whole set (count, currencies, balance per currency,
// account ownership) and swaps it in one database transaction, so a save either lands
// complete or leaves the transaction exactly as it was. Editing legs one request at a time
// could fail halfway and leave it unbalanced (#432).
//
// Pure (no Svelte) so it is unit-tested; the modal holds the draft and runs the plan.

import type { Posting } from './transactionUtils'

// One row of the editor: an existing leg (possibly edited or marked for removal) or a new one.
export interface LedgerDraftPosting extends Posting {
  markedForDelete: boolean
  isNew: boolean
}

export interface LedgerSnapshot {
  date: string
  description: string
}

export interface LedgerSavePlan {
  // The full posting set to send, in the editor's order. Null when no leg changed.
  postings: Omit<Posting, 'id'>[] | null
  // The header fields that changed. Null when neither did.
  patch: { date?: string; description?: string | null } | null
}

// True when the rows differ from the original postings in any way that has to be saved:
// a new row, a removed row, or an edited account, amount or currency. A row added and then
// removed again before saving is no change.
export function postingsChanged(original: Posting[], rows: LedgerDraftPosting[]): boolean {
  const byId = new Map(original.map((p) => [p.id, p]))
  return rows.some((row) => {
    if (row.isNew) return !row.markedForDelete
    if (row.markedForDelete) return true
    const o = byId.get(row.id)
    return (
      o !== undefined &&
      (row.accountId !== o.accountId || row.amount !== o.amount || row.currency !== o.currency)
    )
  })
}

export function planLedgerSave(
  original: LedgerSnapshot & { postings: Posting[] },
  draft: LedgerSnapshot & { postings: LedgerDraftPosting[] },
): LedgerSavePlan {
  const postings = postingsChanged(original.postings, draft.postings)
    ? draft.postings
        .filter((row) => !row.markedForDelete)
        .map(({ accountId, amount, currency }) => ({ accountId, amount, currency }))
    : null

  const patch: NonNullable<LedgerSavePlan['patch']> = {}
  if (draft.date !== original.date) patch.date = draft.date
  if (draft.description !== original.description) patch.description = draft.description || null

  return { postings, patch: Object.keys(patch).length > 0 ? patch : null }
}
