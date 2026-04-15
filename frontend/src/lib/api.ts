// All /api/* requests are proxied by the SvelteKit server to the backend.
// Empty base means same-origin, which works in both dev and production.
const BASE = ''

export type Account = {
  id: string
  path: string
  name?: string | null
  createdAt?: string
  deletedAt?: string | null
}

export async function fetchAccount(id: string): Promise<Account> {
  const res = await fetch(`${BASE}/api/accounts/${id}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Account not found: ${id}`)
  return res.json()
}

export async function updateAccount(
  id: string,
  updates: { name?: string | null },
): Promise<Account> {
  const res = await fetch(`${BASE}/api/accounts/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update account')
  return res.json()
}

export async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch(`${BASE}/api/accounts`, { credentials: 'include' })
  return res.json()
}

export async function createAccount(body: { path: string }) {
  const res = await fetch(`${BASE}/api/accounts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function deleteAccount(id: string) {
  const res = await fetch(`${BASE}/api/accounts/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
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

export async function deleteCategory(id: string) {
  const res = await fetch(`${BASE}/api/categories/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
}

// Mirrors the ParsedTransaction discriminated union from the backend.

export type PossibleDuplicate = {
  transactionId: string
  date: string
  amount: string
  currency: string
} | null

export type RegularParsedTransaction = {
  isTransfer: false
  date: string
  amount: string
  description?: string
  currency?: string
  possibleDuplicate?: PossibleDuplicate
}

export type TransferParsedTransaction = {
  isTransfer: true
  date: string
  description?: string
  sourceAmount: string
  sourceCurrency: string
  targetAmount: string
  targetCurrency: string
  feeAmount?: string
  feeCurrency?: string
  possibleDuplicate?: PossibleDuplicate
}

export type SameCurrencyTransferParsedTransaction = {
  isTransfer: 'same-currency'
  date: string
  description?: string
  amount: string // net amount received (positive)
  feeAmount: string // fee charged (positive)
  currency: string
  possibleDuplicate?: PossibleDuplicate
}

export type ParsedTransaction =
  | RegularParsedTransaction
  | TransferParsedTransaction
  | SameCurrencyTransferParsedTransaction

// Commit payloads — ParsedTransaction plus the account IDs resolved during preview.
export type RegularCommitTransaction = RegularParsedTransaction & {
  offsetAccountId: string
  sourceAccountId?: string // set for regular rows in a multi-currency parser
}

export type TransferCommitTransaction = TransferParsedTransaction & {
  sourceAccountId: string
  targetAccountId: string
  conversionAccountId: string
  feeAccountId: string
}

export type SameCurrencyTransferCommitTransaction =
  SameCurrencyTransferParsedTransaction & {
    targetAccountId: string
    sourceAccountId: string
    feeAccountId: string
  }

export type CommitTransaction =
  | RegularCommitTransaction
  | TransferCommitTransaction
  | SameCurrencyTransferCommitTransaction

export type ImportPreviewResult = {
  parser: string
  defaultAccountId: string | null
  isMultiCurrency: boolean
  defaultFeeAccountId: string | null
  transactions: ParsedTransaction[]
  errors: { row: number; reason: string }[]
}

export async function importPreview(
  file: File,
  defaultCurrency: string,
): Promise<ImportPreviewResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('defaultCurrency', defaultCurrency)
  const res = await fetch(`${BASE}/api/import/preview`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? 'Failed to parse CSV.')
  }
  return res.json()
}

export async function importCommit(body: {
  accountId: string // empty string for multi-currency imports (source is per-row)
  defaultCurrency: string
  transactions: CommitTransaction[]
}): Promise<{ created: number }> {
  const res = await fetch(`${BASE}/api/import/commit`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export type ColumnMapping = {
  date: string
  amount: string
  description?: string | null
  currency?: string | null
  // Multi-currency transfer fields
  sourceAmount?: string | null
  sourceCurrency?: string | null
  targetAmount?: string | null
  targetCurrency?: string | null
  feeAmount?: string | null
  feeCurrency?: string | null
  signColumn?: string | null
  signNegativeValue?: string | null
}

export type CsvParser = {
  id: string
  name: string
  normalizedHeader: string
  columnMapping: ColumnMapping
  defaultAccountId: string | null
  isMultiCurrency: boolean
  defaultFeeAccountId: string | null
  createdAt: string
  deletedAt: string | null
}

export async function fetchParsers(): Promise<CsvParser[]> {
  const res = await fetch(`${BASE}/api/parsers`, { credentials: 'include' })
  return res.json()
}

export async function updateParser(
  id: string,
  body: Partial<
    Pick<
      CsvParser,
      | 'name'
      | 'columnMapping'
      | 'defaultAccountId'
      | 'isMultiCurrency'
      | 'defaultFeeAccountId'
    >
  >,
): Promise<CsvParser> {
  const res = await fetch(`${BASE}/api/parsers/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function createParser(body: {
  name: string
  normalizedHeader: string
  columnMapping: ColumnMapping
  defaultAccountId?: string | null
  isMultiCurrency?: boolean
  defaultFeeAccountId?: string | null
}): Promise<CsvParser> {
  const res = await fetch(`${BASE}/api/parsers`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to create parser')
  return res.json()
}

export async function deleteParser(id: string): Promise<void> {
  await fetch(`${BASE}/api/parsers/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
}

export type UserPreferences = {
  dashboardHiddenCurrencies?: string[]
  hiddenAccountIds?: string[]
}

export type UserSettings = {
  id: string
  userId: string
  defaultOffsetAccountId: string | null
  defaultConversionAccountId: string | null
  defaultAssetsRootPath: string
  defaultLiabilitiesRootPath: string
  defaultExpensesRootPath: string
  defaultEquityRootPath: string
  defaultAdjustmentsAccountId: string | null
  preferredCurrency: string
  preferences: UserPreferences
  createdAt: string
  updatedAt: string
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const res = await fetch(`${BASE}/api/user-settings`, {
    credentials: 'include',
  })
  return res.json()
}

export async function updateUserSettings(
  body: Partial<
    Pick<
      UserSettings,
      | 'defaultOffsetAccountId'
      | 'defaultConversionAccountId'
      | 'defaultAdjustmentsAccountId'
      | 'defaultAssetsRootPath'
      | 'defaultLiabilitiesRootPath'
      | 'defaultExpensesRootPath'
      | 'defaultEquityRootPath'
      | 'preferredCurrency'
    >
  > & { preferences?: UserPreferences },
): Promise<UserSettings> {
  const res = await fetch(`${BASE}/api/user-settings`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export type AccountBalance = {
  id: string
  path: string
  name?: string | null
  type: 'asset' | 'liability' | 'equity'
  balances: { currency: string; amount: string }[]
}

export async function fetchAccountBalances(): Promise<AccountBalance[]> {
  const res = await fetch(`${BASE}/api/accounts/balances`, {
    credentials: 'include',
  })
  return res.json()
}

export type AccountBalanceAtDate = {
  accountId: string
  date: string
  balances: { currency: string; amount: string }[]
}

export async function fetchAccountBalanceAtDate(
  accountId: string,
  date: string,
): Promise<AccountBalanceAtDate> {
  const res = await fetch(
    `${BASE}/api/accounts/${accountId}/balance?date=${encodeURIComponent(date)}`,
    { credentials: 'include' },
  )
  if (!res.ok)
    throw new Error(
      (await res.json()).error ?? 'Failed to fetch account balance',
    )
  return res.json()
}

export async function deleteTransaction(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/transactions/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to delete transaction')
}

export async function patchTransaction(
  id: string,
  updates: { description?: string | null; date?: string },
) {
  const res = await fetch(`${BASE}/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(updates),
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to update transaction')
  return res.json()
}

export async function patchPosting(
  id: string,
  updates: { accountId?: string; amount?: string; currency?: string },
) {
  const res = await fetch(`${BASE}/api/postings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(updates),
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to update posting')
  return res.json()
}

export type SpendingSummary = {
  total: Record<string, string>
  categories: {
    category: string
    total: Record<string, string>
    childCount: number
  }[]
}

export async function fetchSpendingSummary(
  from: string,
  to: string,
  prefix?: string,
): Promise<SpendingSummary> {
  const params = new URLSearchParams({ from, to })
  if (prefix) params.set('prefix', prefix)
  const res = await fetch(`${BASE}/api/reports/spending-summary?${params}`, {
    credentials: 'include',
  })
  return res.json()
}

export type MonthlySpend = { month: string; total: Record<string, string> }

export async function fetchMonthlySpend(
  months: number,
): Promise<MonthlySpend[]> {
  const res = await fetch(
    `${BASE}/api/reports/monthly-spend?months=${months}`,
    { credentials: 'include' },
  )
  return res.json()
}

export type WeeklySpend = {
  week: string
  weekStart: string
  total: Record<string, string>
}

export async function fetchWeeklySpend(weeks: number): Promise<WeeklySpend[]> {
  const res = await fetch(`${BASE}/api/reports/weekly-spend?weeks=${weeks}`, {
    credentials: 'include',
  })
  return res.json()
}

export async function createPosting(body: {
  transactionId: string
  accountId: string
  amount: string
  currency: string
}) {
  const res = await fetch(`${BASE}/api/postings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to create posting')
  return (await res.json()) as {
    id: string
    accountId: string
    amount: string
    currency: string
  }
}

export async function deletePosting(id: string) {
  const res = await fetch(`${BASE}/api/postings/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to delete posting')
}

export type Posting = {
  id: string
  accountId: string
  amount: string
  currency: string
}

export type Transaction = {
  id: string
  userId: string
  date: string
  description: string | null
  postings: Posting[]
}

export async function createTransaction(body: {
  date: string
  description?: string
  postings: { accountId: string; amount: string; currency: string }[]
}): Promise<Transaction> {
  const res = await fetch(`${BASE}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to create transaction')
  return res.json()
}

export async function replacePostings(
  transactionId: string,
  postings: { accountId: string; amount: string; currency: string }[],
) {
  const res = await fetch(
    `${BASE}/api/transactions/${transactionId}/postings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ postings }),
    },
  )
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to update postings')
  return res.json()
}

// Returns { date, from, to, rate } or null if no rate is available for the date.
export async function fetchFxRate(
  date: string,
  from: string,
  to: string,
): Promise<{ date: string; from: string; to: string; rate: string } | null> {
  const res = await fetch(
    `${BASE}/api/fx-rates?${new URLSearchParams({ date, from, to })}`,
    { credentials: 'include' },
  )
  if (!res.ok) return null
  return res.json()
}

export async function fetchActionRequiredSummary(): Promise<
  { accountId: string; count: number }[]
> {
  const res = await fetch(`${BASE}/api/accounts/action-required-summary`, {
    credentials: "include",
  })
  return res.json()
}

export async function fetchActionRequired(
  accountId: string,
): Promise<{ count: number; transactionIds: string[]; missingRates: { date: string; from: string; to: string }[] }> {
  const res = await fetch(
    `${BASE}/api/accounts/${accountId}/action-required`,
    { credentials: "include" },
  )
  return res.json()
}

export async function fetchTransactions(params?: {
  from?: string
  to?: string
  accountId?: string
  accountPath?: string
}): Promise<Transaction[]> {
  const query = new URLSearchParams()
  if (params?.from) query.set('from', params.from)
  if (params?.to) query.set('to', params.to)
  if (params?.accountId) query.set('accountId', params.accountId)
  if (params?.accountPath) query.set('accountPath', params.accountPath)
  const qs = query.toString()
  const res = await fetch(`${BASE}/api/transactions${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
  })
  return res.json()
}

