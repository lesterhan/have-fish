const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8887'

export async function fetchAccounts() {
  const res = await fetch(`${BASE}/api/accounts`, { credentials: 'include' })
  return res.json()
}

export async function createAccount(body: { name: string; type: string; currency: string }) {
  const res = await fetch(`${BASE}/api/accounts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function fetchCategories() {
  const res = await fetch(`${BASE}/api/categories`, { credentials: 'include' })
  return res.json()
}

export async function createCategory(body: { name: string }) {
  const res = await fetch(`${BASE}/api/categories`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function fetchTransactions(accountId?: string) {
  const url = accountId
    ? `${BASE}/api/transactions?accountId=${accountId}`
    : `${BASE}/api/transactions`
  const res = await fetch(url, { credentials: 'include' })
  return res.json()
}
