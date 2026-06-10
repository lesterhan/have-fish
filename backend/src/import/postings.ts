export type PostingSpec = {
  transactionId: string
  accountId: string
  amount: string
  currency: string
}

// Builds the 2 postings for a regular (non-Fish-Pie) import transaction.
export function buildRegularPostings(opts: {
  transactionId: string
  sourceAccountId: string
  amount: string
  offsetAccountId: string
  currency: string
}): PostingSpec[] {
  const { transactionId, sourceAccountId, amount, offsetAccountId, currency } = opts
  const negated = (-parseFloat(amount)).toFixed(2)
  return [
    { transactionId, accountId: sourceAccountId, amount, currency },
    { transactionId, accountId: offsetAccountId, amount: negated, currency },
  ]
}

// Builds 3 postings for a Fish Pie import transaction.
//
// Splits `negated` proportionally between the group clearing account (others' share)
// and the payer's expense account (their own share). This eliminates the payer member
// transaction for import-linked expenses — the import tx already records the payer's share.
//
// All three postings sum to zero:
//   source(t.amount) + groupAccount(othersShare) + expenseAccount(payerShare)
//   = t.amount + (-t.amount × othersRatio) + (-t.amount × payerRatio)
//   = t.amount - t.amount = 0 ✓
//
// payerShareRatio: payer's shareWeight / totalWeight, e.g. 0.5 for 50/50
export function buildFishPiePostings(opts: {
  transactionId: string
  sourceAccountId: string
  amount: string
  groupAccountId: string
  expenseAccountId: string
  payerShareRatio: number
  currency: string
}): PostingSpec[] {
  const { transactionId, sourceAccountId, amount, groupAccountId, expenseAccountId, payerShareRatio, currency } = opts
  const negated = -parseFloat(amount)
  const payerShare = (negated * payerShareRatio).toFixed(2)
  // othersShare is negated minus payerShare (remainder) so the three postings always sum to zero.
  const othersShare = (negated - parseFloat(payerShare)).toFixed(2)
  return [
    { transactionId, accountId: sourceAccountId, amount, currency },
    { transactionId, accountId: groupAccountId, amount: othersShare, currency },
    { transactionId, accountId: expenseAccountId, amount: payerShare, currency },
  ]
}
