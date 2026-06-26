// In-place edit orchestration for TransactionDetail's edit mode (Flow Narration story 6a).
//
// Edit mode exposes the same small surface the retired SummaryEditModal did: the subject
// leg account(s) (recategorize), the description, and the date. Every mechanical leg
// (transfer/conversion/fee/share) stays read-only, so the entry can't be unbalanced and no
// new validation is introduced — amounts never change here. Amount edits drop to the ledger.
//
// This module is the pure, testable core; the component is thin presentation over it. The
// save logic itself is reused untouched from summaryEdit.ts (buildRecategorizePayload →
// replacePostings, then patchTransaction for the header). The backend re-validates balance
// on replacePostings regardless, so a malformed payload is still rejected server-side.

import type { Posting, Transaction } from '$lib/api'
import {
  canSummaryEdit,
  recategorizableLegs,
  initialSubjectDrafts,
  hasAccountChange,
  buildRecategorizePayload,
  type SubjectDraft,
} from './summaryEdit'

// A transaction can be recategorized in place only when it narrates into ≥1 subject leg.
// Shapes with no subject (pure transfers, opening-balance equity) have nothing to edit
// here — the component offers only the raw-ledger escape hatch for them.
export { canSummaryEdit }

// The full mutable draft of an edit session: header fields + one account draft per subject.
export type EditDraft = {
  date: string // yyyy-mm-dd
  description: string
  subjects: SubjectDraft[]
}

// The work a save must perform, decided from the draft. Either field may be null when that
// part is unchanged — the component executes only the non-null pieces. Mirrors exactly what
// SummaryEditModal.handleSave did: repoint subject accounts first (balance re-validated
// server-side), then patch the header.
export type SavePlan = {
  recategorize: { accountId: string; amount: string; currency: string }[] | null
  patch: { date?: string; description?: string | null } | null
}

// yyyy-mm-dd slice of a stored timestamp.
const dateOnly = (d: string): string => d.substring(0, 10)

// The posting ids the user may recategorize — the subject (meaningful spend/income) legs.
// Drives which hero/branch rows render an account picker in edit mode.
export function editableSubjectIds(postings: Posting[]): Set<string> {
  return new Set(recategorizableLegs(postings).map((p) => p.id))
}

// Seeds a fresh draft from the transaction: header fields + one draft per subject leg.
export function initialEditDraft(tx: Transaction): EditDraft {
  return {
    date: dateOnly(tx.date),
    description: tx.description ?? '',
    subjects: initialSubjectDrafts(tx.postings),
  }
}

// Repoints one subject leg's draft account. Returns a new subjects array (immutable update)
// so callers can assign it back to reactive state.
export function setSubjectAccount(
  subjects: SubjectDraft[],
  postingId: string,
  accountId: string,
): SubjectDraft[] {
  return subjects.map((d) =>
    d.postingId === postingId ? { ...d, accountId } : d,
  )
}

// True when the draft differs from the stored transaction in any savable way: a subject leg
// repointed, the date changed, or the (trimmed) description changed.
export function isDirty(tx: Transaction, draft: EditDraft): boolean {
  return (
    draft.date !== dateOnly(tx.date) ||
    draft.description.trim() !== (tx.description ?? '') ||
    hasAccountChange(tx.postings, draft.subjects)
  )
}

// Decides the API calls a save needs. Account repoint and header patch are independent —
// either, both, or (when called on a clean draft) neither.
export function buildSavePlan(tx: Transaction, draft: EditDraft): SavePlan {
  const accountChanged = hasAccountChange(tx.postings, draft.subjects)
  const desc = draft.description.trim()
  const dateChanged = draft.date !== dateOnly(tx.date)
  const descChanged = desc !== (tx.description ?? '')
  return {
    recategorize: accountChanged
      ? buildRecategorizePayload(tx.postings, draft.subjects)
      : null,
    patch:
      dateChanged || descChanged
        ? {
            ...(dateChanged ? { date: draft.date } : {}),
            ...(descChanged ? { description: desc || null } : {}),
          }
        : null,
  }
}
