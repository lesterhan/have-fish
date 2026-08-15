import type { PossibleDuplicate } from '$lib/api'

// The user's decisions for one preview row, one entry per parsed transaction.
//
// Lives in a plain module rather than on the panel component because the import session
// store serializes it to localStorage — keeping it here avoids a .ts file importing types
// out of a .svelte one.
export type RowState = {
  offsetAccountId: string
  conversionAccountId: string
  feeAccountId: string
  skipped: boolean
  possibleDuplicate?: PossibleDuplicate
  groupId: string | null
  // Meaningful only when groupId is set; null = uncategorized fish-pie split.
  categoryId: string | null
  // Cross-currency rows only: 'spend' = purchase in a currency the user doesn't hold
  // (target is an expense), 'transfer' = convert-and-park (target is an asset).
  kind: 'spend' | 'transfer'
  // The expense account for a cross-currency spend.
  expenseAccountId: string
  // Where this row's assignment came from. Recorded rather than inferred, so the Review
  // step can tell a row the user decided on from one still sitting at its default.
  //
  //   none    — no rule matched; sitting at the uncategorized default
  //   rule    — pre-filled by an active import rule
  //   cluster — written by a Sort-step bulk assign (story 6)
  //   user    — the user assigned it directly (story 7 sets this on edit)
  source: RowSource
}

export type RowSource = 'none' | 'rule' | 'cluster' | 'user'
