const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export async function fetchAccounts() {
  const res = await fetch(`${BASE}/api/accounts`)
  return res.json()
}

export async function fetchTransactions(accountId?: string) {
  const url = accountId
    ? `${BASE}/api/transactions?accountId=${accountId}`
    : `${BASE}/api/transactions`
  const res = await fetch(url)
  return res.json()
}
