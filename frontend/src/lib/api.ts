// All /api/* requests are proxied by the SvelteKit server to the backend.
// Empty base means same-origin, which works in both dev and production.
const BASE = ''

export type Account = {
  id: string
  path: string
  name?: string | null
  defaultCurrency?: string | null
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
  updates: { name?: string | null; defaultCurrency?: string | null },
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

export async function fetchAccountPostingCounts(): Promise<{ accountId: string; count: number }[]> {
  const res = await fetch(`${BASE}/api/accounts/posting-counts`, { credentials: 'include' })
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
  fishPieGroupId?: string
  fishPieGroupName?: string
} | null

export type RegularParsedTransaction = {
  isTransfer: false
  date: string
  amount: string
  description?: string
  currency?: string
  possibleDuplicate?: PossibleDuplicate
  suggestedOffsetAccountId?: string
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

export async function checkDuplicates(
  rows: { accountId: string; date: string; amount: string }[],
): Promise<(PossibleDuplicate | null)[]> {
  const res = await fetch(`${BASE}/api/import/check-duplicates`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  if (!res.ok) throw new Error('Failed to check for duplicates.')
  const data = await res.json()
  return data.duplicates
}

export async function importCommit(body: {
  accountId: string // empty string for multi-currency imports (source is per-row)
  defaultCurrency: string
  transactions: CommitTransaction[]
  groupSplits?: { rowIndex: number; groupId: string; categoryId?: string | null }[]
}): Promise<{ created: number; fishPieExpenses: number }> {
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
  accentColor?: import('$lib/accent').AccentKey
  recentCurrencies?: string[]
  recentGroups?: string[]
  // Sticky last-used category per fish-pie group, keyed by groupId → categoryId.
  lastCategoryByGroup?: Record<string, string>
  // Recently used import split targets, most-recent first. Each entry is
  // `${groupId}:${categoryId}` (empty categoryId = no category).
  recentFishPieSplits?: string[]
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

// A posting as returned by the heal endpoints (joined to its account path).
export type HealPosting = {
  id: string
  accountId: string
  accountPath: string
  amount: string
  currency: string
}

export type MalformedFxSpend = {
  transactionId: string
  date: string
  description: string | null
  before: HealPosting[]
  after: HealPosting[]
  canHeal: boolean
}

// Lists transactions matching the malformed cross-currency-spend shape, with a
// before/after preview of the one-click repair.
export async function fetchMalformedFxSpends(): Promise<{
  candidates: MalformedFxSpend[]
  conversionAccountConfigured: boolean
}> {
  const res = await fetch(`${BASE}/api/transactions/malformed-fx-spend`, {
    credentials: 'include',
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to load malformed transactions')
  return res.json()
}

// Repairs a single malformed cross-currency-spend transaction in place.
export async function healFxSpend(id: string): Promise<{ postings: HealPosting[] }> {
  const res = await fetch(`${BASE}/api/transactions/${id}/heal-fx-spend`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to repair transaction')
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

export type FxPair = { date: string; from: string; to: string; cached: boolean }

export async function fetchSpendingFxPairs(
  from: string,
  to: string,
  targetCurrency: string,
): Promise<{ pairs: FxPair[] }> {
  const params = new URLSearchParams({ from, to, targetCurrency })
  const res = await fetch(`${BASE}/api/reports/spending-fx-pairs?${params}`, {
    credentials: 'include',
  })
  return res.json()
}

export async function fetchSpendingConverted(
  from: string,
  to: string,
  targetCurrency: string,
): Promise<{ total: string | null; missingCount: number }> {
  const params = new URLSearchParams({ from, to, targetCurrency })
  const res = await fetch(`${BASE}/api/reports/spending-converted?${params}`, {
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
  groupExpenseId: string | null
  groupName: string | null
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

export async function createTransactionsBulk(
  txns: {
    date: string
    description?: string
    postings: { accountId: string; amount: string; currency: string }[]
  }[],
): Promise<Transaction[]> {
  const res = await fetch(`${BASE}/api/transactions/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ transactions: txns }),
  })
  if (!res.ok)
    throw new Error((await res.json()).error ?? 'Failed to create transactions')
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

// Most recent published rate (frankfurter has no same-day rate, so the backend walks
// back to the last business day). Returns the rate and the date it applies to, or null.
export async function fetchFxRateAsOf(
  from: string,
  to: string,
): Promise<{ from: string; to: string; rate: string; asOfDate: string } | null> {
  const res = await fetch(
    `${BASE}/api/fx-rates/as-of?${new URLSearchParams({ from, to })}`,
    { credentials: 'include' },
  )
  if (!res.ok) return null
  return res.json()
}

export type ImportRule = {
  id: string
  pattern: string
  accountId: string
  accountPath: string
  accountName: string | null
  status: 'active' | 'suggested' | 'denied'
  matchCount: number
  createdAt: string
  updatedAt: string
}

export async function fetchRules(): Promise<ImportRule[]> {
  const res = await fetch(`${BASE}/api/rules`, { credentials: 'include' })
  return res.json()
}

export async function createRule(body: { pattern: string; accountId: string }): Promise<ImportRule> {
  const res = await fetch(`${BASE}/api/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create rule')
  return res.json()
}

export async function updateRule(id: string, body: { pattern?: string; accountId?: string }): Promise<ImportRule> {
  const res = await fetch(`${BASE}/api/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update rule')
  return res.json()
}

export async function deleteRule(id: string): Promise<void> {
  await fetch(`${BASE}/api/rules/${id}`, { method: 'DELETE', credentials: 'include' })
}

export async function approveRule(id: string): Promise<ImportRule> {
  const res = await fetch(`${BASE}/api/rules/${id}/approve`, { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to approve rule')
  return res.json()
}

export async function denyRule(id: string): Promise<ImportRule> {
  const res = await fetch(`${BASE}/api/rules/${id}/deny`, { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to deny rule')
  return res.json()
}

export async function reviveRule(id: string): Promise<ImportRule> {
  const res = await fetch(`${BASE}/api/rules/${id}/revive`, { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to revive rule')
  return res.json()
}

export async function mineRules(): Promise<{ created: number }> {
  const res = await fetch(`${BASE}/api/rules/mine`, { method: 'POST', credentials: 'include' })
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
): Promise<{ count: number; transactionIds: string[]; malformedTransactionIds: string[] }> {
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

// --- Fish Pie ---

export type GroupMember = {
  id: string
  groupId: string
  userId: string
  shareWeight: number
  defaultExpenseAccountId: string | null
  defaultPaymentAccountId: string | null
  joinedAt: string
  userName: string
  userEmail: string
}

export type GroupCategory = {
  id: string
  groupId: string
  name: string
  sortOrder: number
  archivedAt: string | null
  myMapping: { accountId: string } | null
  weights: { userId: string; weight: number }[]
}

export type ExpenseGroup = {
  id: string
  name: string
  defaultCurrency: string | null
  createdBy: string
  createdAt: string
  deletedAt: string | null
  members: GroupMember[]
  categories: GroupCategory[]
}

export async function fetchGroups(): Promise<ExpenseGroup[]> {
  const res = await fetch(`${BASE}/api/fish-pie/groups`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch groups')
  return res.json()
}

export async function fetchGroup(id: string): Promise<ExpenseGroup> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${id}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Group not found')
  return res.json()
}

export async function createGroup(name: string): Promise<ExpenseGroup> {
  const res = await fetch(`${BASE}/api/fish-pie/groups`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create group')
  return res.json()
}

export async function updateGroup(id: string, data: { name?: string; defaultCurrency?: string | null }): Promise<ExpenseGroup> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update group')
  return res.json()
}

export async function updateMemberWeight(groupId: string, userId: string, shareWeight: number): Promise<GroupMember> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/members/${userId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareWeight }),
  })
  if (!res.ok) throw new Error('Failed to update share weight')
  return res.json()
}

export async function updateMyExpenseAccount(groupId: string, defaultExpenseAccountId: string | null): Promise<GroupMember> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/members/me`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultExpenseAccountId }),
  })
  if (!res.ok) throw new Error('Failed to update expense account')
  return res.json()
}

export async function deleteGroup(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to delete group')
}

// --- Fish-pie group categories (epic: fish-pie-categories) ---

export async function fetchGroupCategories(groupId: string): Promise<GroupCategory[]> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/categories`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch categories')
  return res.json()
}

export async function createGroupCategory(groupId: string, name: string): Promise<GroupCategory> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/categories`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create category')
  return res.json()
}

export async function updateGroupCategory(
  groupId: string,
  categoryId: string,
  data: { name?: string; sortOrder?: number; archived?: boolean },
): Promise<GroupCategory> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/categories/${categoryId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update category')
  return res.json()
}

// Upsert the requesting user's own (private) account mapping for a category.
export async function setCategoryMyMapping(
  groupId: string,
  categoryId: string,
  accountId: string,
): Promise<{ categoryId: string; accountId: string }> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/categories/${categoryId}/my-mapping`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  })
  if (!res.ok) throw new Error('Failed to set category account')
  return res.json()
}

// Set the category's shared split weights. The vector must be complete (one entry per
// current member) or empty to clear — the backend rejects a partial vector.
export async function setCategoryWeights(
  groupId: string,
  categoryId: string,
  weights: { userId: string; weight: number }[],
): Promise<GroupCategory> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/categories/${categoryId}/weights`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights }),
  })
  if (!res.ok) throw new Error('Failed to set category weights')
  return res.json()
}

export type GroupInvite = {
  id: string
  groupId: string
  invitedByUserId: string
  inviteeEmail: string
  status: string
  createdAt: string
  resolvedAt: string | null
  groupName?: string
  inviterName?: string
}

export async function fetchGroupInvites(groupId: string): Promise<GroupInvite[]> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/invites`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch invites')
  return res.json()
}

export async function sendInvite(groupId: string, email: string): Promise<GroupInvite> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/invites`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to send invite')
  }
  return res.json()
}

export async function cancelInvite(groupId: string, inviteId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/invites/${inviteId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to cancel invite')
}

export async function fetchMyInvites(): Promise<GroupInvite[]> {
  const res = await fetch(`${BASE}/api/fish-pie/invites`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch invites')
  return res.json()
}

export async function acceptInvite(inviteId: string): Promise<GroupInvite> {
  const res = await fetch(`${BASE}/api/fish-pie/invites/${inviteId}/accept`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to accept invite')
  return res.json()
}

export async function declineInvite(inviteId: string): Promise<GroupInvite> {
  const res = await fetch(`${BASE}/api/fish-pie/invites/${inviteId}/decline`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to decline invite')
  return res.json()
}

export type ExpenseSplit = {
  id: string
  expenseId: string
  userId: string
  amount: string
  userName: string
  expenseAccountPath: string | null
}

export type GroupExpense = {
  id: string
  groupId: string
  paidByUserId: string
  payerName: string | null
  description: string
  amount: string
  currency: string
  date: string
  transactionId: string | null
  categoryId: string | null
  categoryName: string | null
  createdAt: string
  deletedAt: string | null
  splits: ExpenseSplit[]
}

export async function fetchExpenses(groupId: string): Promise<GroupExpense[]> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/expenses`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch expenses')
  return res.json()
}

export async function updateMyPaymentAccount(groupId: string, defaultPaymentAccountId: string | null): Promise<GroupMember> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/members/me`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultPaymentAccountId }),
  })
  if (!res.ok) throw new Error('Failed to update payment account')
  return res.json()
}

export async function createExpense(
  groupId: string,
  body: { description: string; amount: string; currency: string; date: string; paidByUserId?: string; paymentAccountId: string; categoryId?: string | null },
): Promise<GroupExpense> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/expenses`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to create expense')
  }
  return res.json()
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  body: {
    description?: string
    amount?: string
    currency?: string
    date?: string
    paidByUserId?: string
    splits?: { userId: string; shareWeight: number }[]
    categoryId?: string | null
  },
): Promise<GroupExpense> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/expenses/${expenseId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to update expense')
  }
  return res.json()
}

export async function deleteExpense(groupId: string, expenseId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/expenses/${expenseId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to delete expense')
}

export async function removeGroupExpense(expenseId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fish-pie/group-expenses/${expenseId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to remove from group')
}

export type BalanceTransfer = {
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
  transfers: BalanceTransfer[]
}

export async function fetchBalances(groupId: string): Promise<CurrencyBalance[]> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/balances`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch balances')
  return res.json()
}

// Everything the group page needs in one round-trip — see the backend
// /groups/:id/overview endpoint. Replaces the separate group/expenses/
// balances/settlements/invites fetches.
export type GroupOverview = {
  group: ExpenseGroup
  expenses: GroupExpense[]
  settlements: GroupSettlement[]
  invites: GroupInvite[]
  balances: CurrencyBalance[]
}

export async function fetchGroupOverview(groupId: string): Promise<GroupOverview> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/overview`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load group')
  return res.json()
}

export type GroupSettlement = {
  id: string
  groupId: string
  fromUserId: string
  fromUserName: string | null
  toUserId: string
  toUserName: string | null
  amount: string
  currency: string
  // Cross-currency cash leg. Null ⇒ native settlement (paid in the debt currency).
  settledAmount: string | null
  settledCurrency: string | null
  fxRate: string | null
  batchId: string | null
  date: string
  note: string | null
  status: 'pending' | 'completed'
  payerAccountId: string | null
  payerTransactionId: string | null
  receiverTransactionId: string | null
  createdAt: string
  deletedAt: string | null
}

export async function fetchSettlements(groupId: string): Promise<GroupSettlement[]> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/settlements`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch settlements')
  return res.json()
}

export async function createSettlement(
  groupId: string,
  body: { fromUserId: string; toUserId: string; amount: string; currency: string; date: string; note?: string; payerAccountId: string },
): Promise<GroupSettlement> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/settlements`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to create settlement')
  }
  return res.json()
}

export async function confirmSettlement(
  groupId: string,
  settlementId: string,
  receiverAccountId: string,
): Promise<GroupSettlement> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiverAccountId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to confirm settlement')
  }
  return res.json()
}

export async function deleteSettlement(groupId: string, settlementId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/settlements/${settlementId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to delete settlement')
}

// One debt being settled. Native lines repeat the debt currency/amount in the
// settled* fields; converted lines pay settledAmount of settledCurrency at fxRate.
export type BatchSettlementLine = {
  toUserId: string
  debtAmount: string
  debtCurrency: string
  settledAmount: string
  settledCurrency: string
  fxRate?: string
}

export async function createSettlementBatch(
  groupId: string,
  body: { payerAccountId: string; date: string; note?: string; lines: BatchSettlementLine[] },
): Promise<{ batchId: string; settlements: GroupSettlement[] }> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/settlements/batch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to create settlement')
  }
  return res.json()
}

export async function confirmSettlementBatch(
  groupId: string,
  batchId: string,
  receiverAccountId: string,
): Promise<{ batchId: string; settlements: GroupSettlement[] }> {
  const res = await fetch(`${BASE}/api/fish-pie/groups/${groupId}/settlements/batch/${batchId}/confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiverAccountId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? 'Failed to confirm settlement')
  }
  return res.json()
}

