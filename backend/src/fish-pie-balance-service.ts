// Shared balance computation for a fish-pie group. Used by the balances endpoint
// and the group overview endpoint so the netting logic lives in exactly one place.

export type Transfer = {
  fromUserId: string
  fromUserName: string | null
  toUserId: string
  toUserName: string | null
  amount: string
  currency: string
}

export type CurrencyBalance = {
  currency: string
  netPositions: { userId: string; userName: string | null; amount: string }[]
  transfers: Transfer[]
}

type Member = { userId: string; userName: string | null }
type BalanceExpense = {
  paidByUserId: string
  amount: string
  currency: string
  splits: { userId: string; amount: string }[]
}
type BalanceSettlement = { fromUserId: string; toUserId: string; amount: string; currency: string }

// Greedy creditor/debtor matching — produces a minimal transfer set.
// Positive net = creditor (owed money), negative net = debtor (owes money).
export function simplifyDebts(
  nets: { userId: string; userName: string | null; net: number }[],
): { fromUserId: string; fromUserName: string | null; toUserId: string; toUserName: string | null; amount: number }[] {
  const creditors = nets.filter((n) => n.net > 0.005).map((n) => ({ ...n, remaining: n.net }))
  const debtors = nets.filter((n) => n.net < -0.005).map((n) => ({ ...n, remaining: -n.net }))
  const transfers: { fromUserId: string; fromUserName: string | null; toUserId: string; toUserName: string | null; amount: number }[] = []

  let ci = 0
  let di = 0
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]
    const d = debtors[di]
    const amount = Math.min(c.remaining, d.remaining)
    if (amount > 0.005) {
      transfers.push({ fromUserId: d.userId, fromUserName: d.userName, toUserId: c.userId, toUserName: c.userName, amount })
    }
    c.remaining = Math.round((c.remaining - amount) * 100) / 100
    d.remaining = Math.round((d.remaining - amount) * 100) / 100
    if (c.remaining < 0.005) ci++
    if (d.remaining < 0.005) di++
  }

  return transfers
}

// Build per-currency net positions and the minimal settle-up transfers.
// `settlements` must already be filtered to completed ones.
export function computeCurrencyBalances(
  members: Member[],
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[],
): CurrencyBalance[] {
  const memberIds = members.map((m) => m.userId)
  const userNameMap = new Map(members.map((m) => [m.userId, m.userName]))

  // net[currency][userId] = paid - owed
  const nets = new Map<string, Map<string, number>>()
  const currMap = (curr: string) => {
    let m = nets.get(curr)
    if (!m) {
      m = new Map()
      nets.set(curr, m)
    }
    return m
  }

  for (const e of expenses) {
    const m = currMap(e.currency)
    m.set(e.paidByUserId, (m.get(e.paidByUserId) ?? 0) + parseFloat(e.amount))
    for (const s of e.splits) {
      m.set(s.userId, (m.get(s.userId) ?? 0) - parseFloat(s.amount))
    }
  }

  // fromUser paid toUser → fromUser net += amount, toUser net -= amount
  for (const s of settlements) {
    const m = currMap(s.currency)
    const amt = parseFloat(s.amount)
    m.set(s.fromUserId, (m.get(s.fromUserId) ?? 0) + amt)
    m.set(s.toUserId, (m.get(s.toUserId) ?? 0) - amt)
  }

  const result: CurrencyBalance[] = []
  for (const [currency, map] of nets) {
    const netList = memberIds.map((uid) => ({
      userId: uid,
      userName: userNameMap.get(uid) ?? null,
      net: Math.round((map.get(uid) ?? 0) * 100) / 100,
    }))
    const transfers = simplifyDebts(netList)
    result.push({
      currency,
      netPositions: netList.map((n) => ({ userId: n.userId, userName: n.userName, amount: n.net.toFixed(2) })),
      transfers: transfers.map((t) => ({
        fromUserId: t.fromUserId,
        fromUserName: t.fromUserName,
        toUserId: t.toUserId,
        toUserName: t.toUserName,
        amount: t.amount.toFixed(2),
        currency,
      })),
    })
  }

  return result
}
