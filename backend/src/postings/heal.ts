// Detection + repair for malformed cross-currency-spend transactions.
//
// Before the dedicated import path existed, a purchase made in a currency the user didn't
// hold (funded from another balance via on-the-fly conversion) was imported with the wrong
// accounts: the expense account was reused as the FX bridge on BOTH currency sides, and the
// spend was dumped into the target-currency *balance* account — creating a phantom holding
// and double-booking the spend with opposite signs across the two currencies.
//
//   assets:bank:savings:usd  -17.29 USD
//   expenses:food:coffee     +17.24 USD   ✗ bridge masquerading as the expense
//   expenses:banking          +0.05 USD   (fee — correct)
//   expenses:food:coffee     -360.00 CZK  ✗ bridge masquerading as the expense
//   assets:bank:savings:czk  +360.00 CZK  ✗ phantom holding — should be the spend
//
// The fix is a pure 3-account repoint (amounts never change, so balance is preserved):
//   - the expense account's source-currency leg → the conversion account
//   - the expense account's target-currency leg → the conversion account
//   - the phantom balance-account leg           → the expense account
//
// yielding the correct shape (equity:conversions bridges both sides, the spend is a single
// leg on the expense account, no phantom holding). Idempotent: a repaired transaction has an
// equity bridge leg and is no longer detected.

export type HealPosting = {
  id: string
  accountId: string
  accountPath: string
  amount: string
  currency: string
}

export type HealSettings = {
  expensesRootPath: string
  assetsRootPath: string
  liabilitiesRootPath: string
  equityRootPath: string
}

export type MalformedFinding = {
  expenseAccountId: string
  expenseAccountPath: string
  // The expense leg in the source (funding) currency — should be the conversion bridge.
  sourceBridgePostingId: string
  // The expense leg in the target (spend) currency — should be the conversion bridge.
  targetBridgePostingId: string
  // The balance-account leg holding the phantom target-currency amount — should be the spend.
  phantomPostingId: string
  targetCurrency: string
  sourceCurrency: string
}

export type Repoint = { postingId: string; toAccountId: string }

const under = (path: string, root: string) => path === root || path.startsWith(`${root}:`)

// Detects the malformed cross-currency-spend shape. Returns null for anything else —
// healthy transactions (any shape with an equity bridge leg, plain spends, Fish Pie splits,
// genuine convert-and-hold), so it is safe to run over every transaction.
export function detectMalformedFxSpend(
  postings: HealPosting[],
  settings: HealSettings,
): MalformedFinding | null {
  const { expensesRootPath, assetsRootPath, liabilitiesRootPath, equityRootPath } = settings

  const isExpense = (p: HealPosting) => under(p.accountPath, expensesRootPath)
  const isBalance = (p: HealPosting) =>
    under(p.accountPath, assetsRootPath) || under(p.accountPath, liabilitiesRootPath)

  const currencies = [...new Set(postings.map((p) => p.currency))]
  if (currencies.length !== 2) return null

  // A genuine conversion already bridges through an equity account — never the broken shape.
  if (postings.some((p) => under(p.accountPath, equityRootPath))) return null

  // The tell: a single expense account posted in BOTH currencies with opposite signs.
  // (The fee is an expense too, but appears only in the source currency, so it never matches.)
  const expenseByAccount = new Map<string, HealPosting[]>()
  for (const p of postings) {
    if (!isExpense(p)) continue
    const legs = expenseByAccount.get(p.accountId) ?? []
    legs.push(p)
    expenseByAccount.set(p.accountId, legs)
  }

  let finding: MalformedFinding | null = null
  for (const [accountId, legs] of expenseByAccount) {
    if (legs.length < 2) continue
    const byCurrency = new Map<string, HealPosting>()
    for (const leg of legs) {
      // If the same account+currency appears twice we can't confidently identify the bridge.
      if (byCurrency.has(leg.currency)) return null
      byCurrency.set(leg.currency, leg)
    }
    if (byCurrency.size !== 2) continue

    const [a, b] = [...byCurrency.values()]
    const aVal = parseFloat(a.amount)
    const bVal = parseFloat(b.amount)
    if (Math.sign(aVal) === Math.sign(bVal)) continue // must be opposite signs

    // The bridge legs: positive one is the source side, negative one the target (spend) side.
    const sourceLeg = aVal > 0 ? a : b
    const targetLeg = aVal > 0 ? b : a

    // The phantom: a balance account holding the positive target-currency amount that
    // mirrors the (negative) target bridge leg.
    const phantom = postings.find(
      (p) =>
        isBalance(p) &&
        p.currency === targetLeg.currency &&
        parseFloat(p.amount) > 0 &&
        Math.abs(parseFloat(p.amount) - Math.abs(parseFloat(targetLeg.amount))) < 0.005,
    )
    if (!phantom) continue

    // More than one matching expense account is ambiguous — bail rather than guess.
    if (finding) return null
    finding = {
      expenseAccountId: accountId,
      expenseAccountPath: sourceLeg.accountPath,
      sourceBridgePostingId: sourceLeg.id,
      targetBridgePostingId: targetLeg.id,
      phantomPostingId: phantom.id,
      sourceCurrency: sourceLeg.currency,
      targetCurrency: targetLeg.currency,
    }
  }

  return finding
}

// Builds the repoint plan that turns a malformed finding into the correct shape.
// Pure: only accountIds change, so the per-currency balance is unaffected.
export function planFxSpendRepair(finding: MalformedFinding, conversionAccountId: string): Repoint[] {
  return [
    { postingId: finding.sourceBridgePostingId, toAccountId: conversionAccountId },
    { postingId: finding.targetBridgePostingId, toAccountId: conversionAccountId },
    { postingId: finding.phantomPostingId, toAccountId: finding.expenseAccountId },
  ]
}
