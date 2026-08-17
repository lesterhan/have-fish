import { describe, it, expect } from 'bun:test'
import {
  STORAGE_KEY,
  SESSION_VERSION,
  MAX_AGE_DAYS,
  MAX_SESSIONS,
  pruneSessions,
  isFresh,
  loadSessions,
  saveSession,
  clearSession,
  latestSession,
  describeAge,
  type ImportSession,
  type SessionStorageLike,
} from './import-session'

const NOW = Date.parse('2026-06-15T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function fakeStorage(initial?: string): SessionStorageLike & { raw: () => string | null } {
  let value: string | null = initial ?? null
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v
    },
    removeItem: () => {
      value = null
    },
    raw: () => value,
  }
}

function makeSession(overrides: Partial<ImportSession> = {}): ImportSession {
  return {
    version: SESSION_VERSION,
    fileHash: 'abc123',
    fileName: 'wise-june.csv',
    step: 'review',
    defaultCurrency: 'CAD',
    fromAccountId: 'acct-1',
    currencyAccounts: {},
    clusterStates: [],
    importAsLiabilities: null,
    preview: {
      parser: 'Wise',
      defaultAccountId: 'acct-1',
      isMultiCurrency: false,
      defaultFeeAccountId: null,
      transactions: [
        { isTransfer: false, date: '2026-06-01', amount: '-42.50', description: 'LOBLAWS #042' },
      ],
      errors: [],
    },
    rowStates: [
      {
        offsetAccountId: 'acct-2',
        conversionAccountId: '',
        feeAccountId: '',
        skipped: false,
        groupId: null,
        categoryId: null,
        kind: 'spend',
        expenseAccountId: '',
        source: 'rule',
      },
    ],
    savedAt: new Date(NOW).toISOString(),
    ...overrides,
  }
}

describe('session round-trip', () => {
  it('restores a saved session unchanged', () => {
    const storage = fakeStorage()
    const session = makeSession()

    saveSession(session, NOW, storage)
    const [restored] = loadSessions(NOW, storage)

    expect(restored).toEqual(session)
  })

  it('preserves a hand-pointed currency mapping', () => {
    // RMB pointed at the CNY account — the case path derivation cannot express.
    const storage = fakeStorage()
    saveSession(makeSession({ currencyAccounts: { CAD: 'a-cad', RMB: 'a-cny' } }), NOW, storage)

    const [restored] = loadSessions(NOW, storage)
    expect(restored.currencyAccounts).toEqual({ CAD: 'a-cad', RMB: 'a-cny' })
  })

  it('preserves row decisions through serialization', () => {
    const storage = fakeStorage()
    const session = makeSession({
      rowStates: [
        {
          offsetAccountId: 'acct-9',
          conversionAccountId: 'acct-conv',
          feeAccountId: 'acct-fee',
          skipped: true,
          groupId: 'group-1',
          categoryId: 'cat-1',
          kind: 'transfer',
          expenseAccountId: 'acct-exp',
          source: 'user',
        },
      ],
    })

    saveSession(session, NOW, storage)
    const [restored] = loadSessions(NOW, storage)

    expect(restored.rowStates[0].groupId).toBe('group-1')
    expect(restored.rowStates[0].skipped).toBe(true)
    expect(restored.rowStates[0].source).toBe('user')
  })

  it('replaces the session for the same file rather than duplicating it', () => {
    const storage = fakeStorage()
    saveSession(makeSession({ step: 'file' }), NOW, storage)
    saveSession(makeSession({ step: 'review' }), NOW + 1000, storage)

    const sessions = loadSessions(NOW + 1000, storage)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].step).toBe('review')
  })

  it('keeps sessions for different files side by side', () => {
    const storage = fakeStorage()
    saveSession(makeSession({ fileHash: 'aaa', fileName: 'a.csv' }), NOW, storage)
    saveSession(makeSession({ fileHash: 'bbb', fileName: 'b.csv' }), NOW + 1000, storage)

    expect(loadSessions(NOW + 1000, storage)).toHaveLength(2)
  })
})

describe('clearing', () => {
  it('drops only the named session', () => {
    const storage = fakeStorage()
    saveSession(makeSession({ fileHash: 'aaa' }), NOW, storage)
    saveSession(makeSession({ fileHash: 'bbb' }), NOW, storage)

    clearSession('aaa', NOW, storage)

    const remaining = loadSessions(NOW, storage)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].fileHash).toBe('bbb')
  })

  it('removes the storage entry entirely once the last session is cleared', () => {
    const storage = fakeStorage()
    saveSession(makeSession({ fileHash: 'aaa' }), NOW, storage)

    clearSession('aaa', NOW, storage)

    expect(storage.raw()).toBeNull()
    expect(loadSessions(NOW, storage)).toHaveLength(0)
  })
})

describe('staleness', () => {
  it('treats a session inside the window as fresh', () => {
    const session = makeSession({ savedAt: new Date(NOW - 29 * DAY).toISOString() })
    expect(isFresh(session, NOW)).toBe(true)
  })

  it('drops a session older than the retention window', () => {
    const storage = fakeStorage()
    saveSession(makeSession({ savedAt: new Date(NOW - (MAX_AGE_DAYS + 1) * DAY).toISOString() }), NOW, storage)

    expect(loadSessions(NOW, storage)).toHaveLength(0)
  })

  it('drops a session dated in the future', () => {
    // A clock change backwards would otherwise strand a session that never expires.
    const session = makeSession({ savedAt: new Date(NOW + DAY).toISOString() })
    expect(isFresh(session, NOW)).toBe(false)
  })
})

describe('pruning', () => {
  it('drops a session written by an older version', () => {
    const stale = { ...makeSession(), version: SESSION_VERSION - 1 }
    expect(pruneSessions([stale], NOW)).toHaveLength(0)
  })

  it('drops entries missing required fields', () => {
    expect(pruneSessions([{ version: SESSION_VERSION, fileHash: 'x' }], NOW)).toHaveLength(0)
  })

  it('drops an entry with an unrecognized step', () => {
    expect(pruneSessions([{ ...makeSession(), step: 'confirm' }], NOW)).toHaveLength(0)
  })

  it('accepts the accounts and sort steps', () => {
    expect(pruneSessions([makeSession({ step: 'accounts' })], NOW)).toHaveLength(1)
    expect(pruneSessions([makeSession({ step: 'sort' })], NOW)).toHaveLength(1)
  })

  it('drops an entry with no cluster states', () => {
    const { clusterStates, ...withoutClusters } = makeSession()
    expect(pruneSessions([withoutClusters], NOW)).toHaveLength(0)
  })

  it('drops an entry with no currency map', () => {
    // A session written before the Accounts step existed; the version guard catches it
    // first, but the shape check must not let one through on its own.
    const { currencyAccounts, ...withoutMap } = makeSession()
    expect(pruneSessions([withoutMap], NOW)).toHaveLength(0)
  })

  it('returns newest first and caps the stored count', () => {
    const many = Array.from({ length: MAX_SESSIONS + 3 }, (_, i) =>
      makeSession({ fileHash: `hash-${i}`, savedAt: new Date(NOW - i * 1000).toISOString() }),
    )

    const pruned = pruneSessions(many, NOW)

    expect(pruned).toHaveLength(MAX_SESSIONS)
    expect(pruned[0].fileHash).toBe('hash-0')
  })

  it('ignores a stored value that is not an array', () => {
    expect(pruneSessions({ nope: true }, NOW)).toHaveLength(0)
  })
})

describe('resilience', () => {
  it('returns no sessions when the stored JSON is corrupt', () => {
    const storage = fakeStorage('{not json')
    expect(loadSessions(NOW, storage)).toHaveLength(0)
  })

  it('returns no sessions when storage is unavailable', () => {
    expect(loadSessions(NOW, null)).toHaveLength(0)
    expect(latestSession(NOW, null)).toBeNull()
  })

  it('keeps the in-progress session when storage is over quota', () => {
    let value: string | null = null
    let rejectLarge = true
    const storage: SessionStorageLike = {
      getItem: () => value,
      setItem: (_k, v) => {
        // Reject the first (multi-session) write, accept the single-session retry.
        if (rejectLarge && v.length > 100) {
          rejectLarge = false
          throw new Error('QuotaExceededError')
        }
        value = v
      },
      removeItem: () => {
        value = null
      },
    }

    saveSession(makeSession({ fileHash: 'aaa' }), NOW, storage)

    const sessions = loadSessions(NOW, storage)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].fileHash).toBe('aaa')
  })

  it('writes under the documented storage key', () => {
    let key = ''
    const storage: SessionStorageLike = {
      getItem: () => null,
      setItem: (k) => {
        key = k
      },
      removeItem: () => {},
    }
    saveSession(makeSession(), NOW, storage)
    expect(key).toBe(STORAGE_KEY)
  })
})

describe('latestSession', () => {
  it('offers the most recently saved import', () => {
    const storage = fakeStorage()
    saveSession(makeSession({ fileHash: 'old', fileName: 'old.csv' }), NOW - 5000, storage)
    saveSession(makeSession({ fileHash: 'new', fileName: 'new.csv' }), NOW, storage)

    expect(latestSession(NOW, storage)?.fileName).toBe('new.csv')
  })

  it('returns null when nothing is saved', () => {
    expect(latestSession(NOW, fakeStorage())).toBeNull()
  })
})

describe('describeAge', () => {
  it('describes recent, hourly and daily ages', () => {
    expect(describeAge(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now')
    expect(describeAge(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 minutes ago')
    expect(describeAge(new Date(NOW - 60_000).toISOString(), NOW)).toBe('1 minute ago')
    expect(describeAge(new Date(NOW - 3 * 60 * 60_000).toISOString(), NOW)).toBe('3 hours ago')
    expect(describeAge(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe('2 days ago')
  })
})
