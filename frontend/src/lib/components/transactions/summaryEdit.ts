// Summary-edit logic — the safe-recategorize path for a multi-posting transaction.
//
// Summary edit exposes only the *meaningful* fields (the subject leg's account, the
// description, the date) and leaves every mechanical leg (transfer/conversion/fee) and
// Fish Pie share leg read-only. Recategorizing a subject only repoints that posting's
// account; amounts never change, so the entry stays balanced per currency. The backend
// re-validates balance on save regardless (replacePostings), so a malformed payload is
// still rejected server-side.
//
// Pure (no Svelte) so it is unit-tested against the canonical shapes. Consumed via detailEdit.ts
// by TransactionDetail's in-place edit mode (canSummaryEdit gates the affordance; the rest build
// the recategorize payload).

import type { Posting } from '$lib/api'
import { narrateTransaction } from './narrate'

// A draft edit of one subject leg: its identity + the (possibly repointed) account.
export type SubjectDraft = {
  postingId: string
  // The account the user has chosen for this leg (defaults to the leg's current account).
  accountId: string
}

// Summary edit is only offered when the transaction narrates into at least one subject leg
// to recategorize. Shapes with no subject — pure transfers, opening-balance equity
// entries, or anything the classifier can't narrate into a meaningful leg — fall back to
// the ledger posting editor so no transaction is ever stranded.
export function canSummaryEdit(postings: Posting[]): boolean {
  return narrateTransaction(postings).subjects.length > 0
}

// The legs a user may recategorize in summary mode — the subject (meaningful spend/income)
// legs, in narration order.
export function recategorizableLegs(postings: Posting[]): Posting[] {
  return narrateTransaction(postings).subjects
}

// Seeds one draft per subject leg from the current postings.
export function initialSubjectDrafts(postings: Posting[]): SubjectDraft[] {
  return recategorizableLegs(postings).map((s) => ({
    postingId: s.id,
    accountId: s.accountId,
  }))
}

// True when any subject draft repoints its leg to a different account. Date/description
// changes are tracked separately by the component.
export function hasAccountChange(postings: Posting[], drafts: SubjectDraft[]): boolean {
  const byId = new Map(postings.map((p) => [p.id, p.accountId]))
  return drafts.some((d) => {
    const next = d.accountId.trim()
    return next !== '' && next !== byId.get(d.postingId)
  })
}

// Builds the full posting payload for replacePostings: every leg passed through unchanged
// except subject legs, which are repointed to their draft account. Only subject legs may
// be repointed; a draft for a non-subject (or unknown) posting is ignored, and a blank
// draft falls back to the leg's current account. Amounts and currencies never change, so
// the result balances per currency exactly as the input did.
export function buildRecategorizePayload(
  postings: Posting[],
  drafts: SubjectDraft[],
): { accountId: string; amount: string; currency: string }[] {
  const subjectIds = new Set(recategorizableLegs(postings).map((s) => s.id))
  const draftById = new Map(drafts.map((d) => [d.postingId, d.accountId.trim()]))
  return postings.map((p) => {
    const draft = subjectIds.has(p.id) ? draftById.get(p.id) : undefined
    return {
      accountId: draft && draft !== '' ? draft : p.accountId,
      amount: p.amount,
      currency: p.currency,
    }
  })
}
