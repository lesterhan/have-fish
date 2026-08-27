import type { ImportPreviewResult } from '$lib/api'
import type { RowState } from '$lib/components/import/row-state'
import type { ClusterState } from '$lib/components/import/clustering'

// An in-progress import, persisted so multi-step navigation (and an accidental refresh)
// doesn't lose a half-categorized CSV.
//
// Shaped as plain serializable JSON so moving this to a backend `import_sessions` table
// later — which is what would let an import survive a device switch — is a transport
// change rather than a rewrite. That move is deliberately out of scope here.

export type ImportStep = 'file' | 'accounts' | 'sort' | 'review' | 'confirm'

const STEP_IDS: ImportStep[] = ['file', 'accounts', 'sort', 'review', 'confirm']

export type ImportSession = {
  version: number
  fileHash: string // sha-256 of the CSV text
  fileName: string
  step: ImportStep
  defaultCurrency: string
  // The account a single-currency import posts to. Multi-currency imports use
  // currencyAccounts instead — a single-currency parser posts every row to one account
  // regardless of the row's currency, so keying that by currency would be a lie.
  fromAccountId: string
  // Currency code → account id, for multi-currency imports. The single source of truth
  // for "where does this currency's money live". Replaces re-deriving the account from a
  // `<root>:<currency>` naming convention, which made it impossible to point a currency
  // at an account that doesn't follow the pattern.
  currencyAccounts: Record<string, string>
  // null = follow the account path (the derived default); a boolean is an explicit override.
  importAsLiabilities: boolean | null
  preview: ImportPreviewResult
  rowStates: RowState[]
  // The Sort step's per-cluster decisions, keyed by merchant stem. Kept so walking back to
  // Sort shows the targets already chosen rather than an empty form.
  clusterStates: ClusterState[]
  // What this import has already written outside the ledger, for the Confirm manifest.
  // Recorded rather than counted at the end because rules and accounts are created as the
  // user goes, not deferred to commit.
  rulesCreated: string[]
  accountsCreated: string[]
  // Set when the import was launched from the Catch-Up Coach, carrying what the coach asked
  // for. Kept in the session rather than read from the URL each time so a refresh mid-import
  // doesn't lose the handoff and silently turn a coached import into an ordinary one.
  catchUp: CatchUpHandoff | null
  // What the user says the file covers, once they have confirmed or edited it. Null until
  // Confirm is reached, at which point it defaults per defaultCoverageRange().
  coverageRange: DateRange | null
  savedAt: string // ISO
}

export type DateRange = { from: string; to: string }

export type CatchUpHandoff = {
  accountId: string
  from: string
  to: string
}

export const STORAGE_KEY = 'havefish:import-sessions'

// Bumped whenever the stored shape changes. A session written by an older version is
// dropped rather than migrated: sessions are short-lived working state, so migration code
// would outlive every session it could ever apply to. Each bump discards in-flight imports
// from the previous deploy — an acceptable trade for not carrying migrations.
//
// 2 — added currencyAccounts and the 'accounts' step.
// 3 — added clusterStates and the 'sort' step.
// 4 — added rulesCreated / accountsCreated and the 'confirm' step.
// 5 — added catchUp and coverageRange.
export const SESSION_VERSION = 5

export const MAX_AGE_DAYS = 30

// Bounds what a stack of large previews can take from the ~5MB localStorage budget.
export const MAX_SESSIONS = 5

const DAY_MS = 24 * 60 * 60 * 1000

// sha-256 of the CSV text. Identifies the file by content, so re-dropping the same export
// finds its session even if it was renamed, and an edited file correctly starts fresh.
export async function hashCsv(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isValidSession(value: unknown): value is ImportSession {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Partial<ImportSession>
  return (
    s.version === SESSION_VERSION &&
    typeof s.fileHash === 'string' &&
    typeof s.fileName === 'string' &&
    STEP_IDS.includes(s.step as ImportStep) &&
    typeof s.savedAt === 'string' &&
    !Number.isNaN(Date.parse(s.savedAt)) &&
    Array.isArray(s.rowStates) &&
    Array.isArray(s.clusterStates) &&
    Array.isArray(s.rulesCreated) &&
    Array.isArray(s.accountsCreated) &&
    typeof s.currencyAccounts === 'object' &&
    s.currencyAccounts !== null &&
    typeof s.preview === 'object' &&
    s.preview !== null
  )
}

export function isFresh(session: ImportSession, now: number): boolean {
  const age = now - Date.parse(session.savedAt)
  return age >= 0 && age <= MAX_AGE_DAYS * DAY_MS
}

// Drops malformed, wrong-version and expired entries, then keeps only the newest
// MAX_SESSIONS. Returned newest-first.
export function pruneSessions(value: unknown, now: number): ImportSession[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is ImportSession => isValidSession(s) && isFresh(s, now))
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, MAX_SESSIONS)
}

// A minimal slice of the Storage API, so these functions are testable without a DOM and
// can't throw on a server render where localStorage doesn't exist.
export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): SessionStorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Access itself throws when storage is disabled (Safari private browsing).
    return null
  }
}

export function loadSessions(
  now: number = Date.now(),
  storage: SessionStorageLike | null = defaultStorage(),
): ImportSession[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    return pruneSessions(JSON.parse(raw), now)
  } catch {
    // Corrupt JSON — treat as no saved sessions rather than breaking the page.
    return []
  }
}

export function saveSession(
  session: ImportSession,
  now: number = Date.now(),
  storage: SessionStorageLike | null = defaultStorage(),
): void {
  if (!storage) return
  const others = loadSessions(now, storage).filter((s) => s.fileHash !== session.fileHash)
  const next = pruneSessions([session, ...others], now)
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Over quota: keep only this session rather than losing the one in progress.
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify([session]))
    } catch {
      // Storage is unusable — the import still works, it just won't survive a refresh.
    }
  }
}

export function clearSession(
  fileHash: string,
  now: number = Date.now(),
  storage: SessionStorageLike | null = defaultStorage(),
): void {
  if (!storage) return
  const remaining = loadSessions(now, storage).filter((s) => s.fileHash !== fileHash)
  try {
    if (remaining.length === 0) storage.removeItem(STORAGE_KEY)
    else storage.setItem(STORAGE_KEY, JSON.stringify(remaining))
  } catch {
    // Nothing useful to do; a stale entry expires on its own within MAX_AGE_DAYS.
  }
}

// The session to offer on mount: the most recently saved one still in progress.
export function latestSession(
  now: number = Date.now(),
  storage: SessionStorageLike | null = defaultStorage(),
): ImportSession | null {
  return loadSessions(now, storage)[0] ?? null
}

// Human-readable age for the resume prompt ("saved 2 hours ago").
export function describeAge(savedAt: string, now: number = Date.now()): string {
  const ms = now - Date.parse(savedAt)
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Reads a coach handoff off the import URL. Returns null unless every part is present and
// well-formed — a half-populated handoff would write coverage for a range nobody asked for.
export function parseCatchUpHandoff(params: URLSearchParams): CatchUpHandoff | null {
  const accountId = params.get('account')
  const from = params.get('from')
  const to = params.get('to')

  if (!accountId || !isIsoDate(from) || !isIsoDate(to)) return null
  if (from! > to!) return null

  return { accountId, from: from!, to: to! }
}

export function isIsoDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().substring(0, 10) === value
}

// What the Confirm step's "this file covers" control starts at.
//
// The coach's requested range wins over the file's own row dates, and the difference is the
// whole point: a statement covering Jul 1-31 whose first transaction is Jul 3 still covers
// Jul 1 and 2. Defaulting to the row dates would leave a two-day hole the coach then asks
// about forever, and the user would have no idea why.
export function defaultCoverageRange(
  handoff: CatchUpHandoff | null,
  fileRange: DateRange | null,
): DateRange | null {
  if (handoff) return { from: handoff.from, to: handoff.to }
  return fileRange
}
