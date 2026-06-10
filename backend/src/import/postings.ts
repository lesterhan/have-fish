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

// Builds 6 postings (5 without fee) for a Fish Pie cross-currency import transaction.
//
// The net target amount is split between the group clearing account (others' share)
// and the payer's expense account (their own share). The fee posting is untouched.
//
// CAD: source(-gross) + conv(+net) + fee(+fee) = 0 ✓
// EUR: conv(-net) + group(+net×others) + expense(+net×payer) = 0 ✓
export function buildFishPieCrossCurrencyPostings(opts: {
  transactionId: string
  sourceAccountId: string
  sourceAmount: string        // negative, e.g. "-15.20"
  sourceCurrency: string
  conversionAccountId: string
  conversionSrcAmount: string // positive net without fee, e.g. "15.00"
  targetAmount: string        // positive, e.g. "10.00"
  targetCurrency: string
  feeAmount?: string          // positive, e.g. "0.20"
  feeCurrency?: string
  feeAccountId?: string
  groupAccountId: string
  expenseAccountId: string
  payerShareRatio: number
}): PostingSpec[] {
  const {
    transactionId, sourceAccountId, sourceAmount, sourceCurrency,
    conversionAccountId, conversionSrcAmount, targetAmount, targetCurrency,
    feeAmount, feeCurrency, feeAccountId,
    groupAccountId, expenseAccountId, payerShareRatio,
  } = opts
  const tgt = parseFloat(targetAmount)
  const payerShare = (tgt * payerShareRatio).toFixed(2)
  const othersShare = (tgt - parseFloat(payerShare)).toFixed(2)

  const specs: PostingSpec[] = [
    { transactionId, accountId: sourceAccountId, amount: sourceAmount, currency: sourceCurrency },
    { transactionId, accountId: conversionAccountId, amount: conversionSrcAmount, currency: sourceCurrency },
    { transactionId, accountId: conversionAccountId, amount: (-tgt).toFixed(2), currency: targetCurrency },
    { transactionId, accountId: groupAccountId, amount: othersShare, currency: targetCurrency },
    { transactionId, accountId: expenseAccountId, amount: payerShare, currency: targetCurrency },
  ]

  if (feeAmount && feeAccountId) {
    specs.splice(2, 0, {
      transactionId,
      accountId: feeAccountId,
      amount: feeAmount,
      currency: feeCurrency ?? sourceCurrency,
    })
  }

  return specs
}

// Builds 4 postings for a Fish Pie same-currency-with-fee import transaction.
//
// The net amount is split between the group clearing account (others' share) and
// the payer's expense account (their own share). The fee and source postings are untouched.
//
// group(+net×others) + expense(+net×payer) + fee(+fee) + source(-gross) = 0 ✓
export function buildFishPieSameCurrencyPostings(opts: {
  transactionId: string
  sourceAccountId: string
  amount: string     // net (positive), e.g. "99.38"
  feeAmount: string  // fee (positive), e.g. "0.62"
  currency: string
  feeAccountId: string
  groupAccountId: string
  expenseAccountId: string
  payerShareRatio: number
}): PostingSpec[] {
  const { transactionId, sourceAccountId, amount, feeAmount, currency,
    feeAccountId, groupAccountId, expenseAccountId, payerShareRatio } = opts
  const net = parseFloat(amount)
  const payerShare = (net * payerShareRatio).toFixed(2)
  const othersShare = (net - parseFloat(payerShare)).toFixed(2)
  const gross = (net + parseFloat(feeAmount)).toFixed(2)
  return [
    { transactionId, accountId: groupAccountId, amount: othersShare, currency },
    { transactionId, accountId: expenseAccountId, amount: payerShare, currency },
    { transactionId, accountId: feeAccountId, amount: feeAmount, currency },
    { transactionId, accountId: sourceAccountId, amount: `-${gross}`, currency },
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
