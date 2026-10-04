import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { importSessions, transactions } from '../db/schema'
import { MAX_SESSIONS } from '../import/session-service'
import { at, clearDatabase, createTestUser, request } from '../test-utils'

// The import page's sessions on the server (#535), and the commit that finishes one.

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const SESSION = {
  fileName: 'statement.csv',
  version: 5,
  rowCount: 2,
  payload: { step: 'review', rowStates: [{ skipped: false }, { skipped: true }] },
}

function save(cookie: string, fileHash: string, body: unknown = SESSION) {
  return request(`/api/import/sessions/${fileHash}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function read(cookie: string, fileHash: string) {
  return request(`/api/import/sessions/${fileHash}`, { headers: { Cookie: cookie } })
}

async function list(cookie: string) {
  const res = await request('/api/import/sessions', { headers: { Cookie: cookie } })
  expect(res.status).toBe(200)
  return ((await res.json()) as { sessions: Record<string, unknown>[] }).sessions
}

async function account(cookie: string, path: string): Promise<string> {
  const res = await request('/api/accounts', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return ((await res.json()) as { id: string }).id
}

function commit(cookie: string, body: Record<string, unknown>) {
  return request('/api/import/commit', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('import sessions', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('saves a session and hands its payload back unchanged', async () => {
    const saved = await save(cookie, HASH_A)
    expect(saved.status).toBe(200)
    expect(typeof ((await saved.json()) as { savedAt: string }).savedAt).toBe('string')

    const res = await read(cookie, HASH_A)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ...SESSION, fileHash: HASH_A, lastError: null })
  })

  it('replaces the session for the same file rather than adding a second', async () => {
    await save(cookie, HASH_A)
    const lastError = { error: 'AMOUNT_INVALID', detail: { amount: 'x', index: 3 } }
    await save(cookie, HASH_A, { ...SESSION, rowCount: 7, lastError })

    const sessions = await list(cookie)
    expect(sessions).toHaveLength(1)
    expect(at(sessions, 0)).toMatchObject({ fileHash: HASH_A, rowCount: 7, lastError })
  })

  it('lists summaries without payloads, most recently saved first', async () => {
    await save(cookie, HASH_A)
    await save(cookie, HASH_B, { ...SESSION, fileName: 'second.csv' })

    const sessions = await list(cookie)
    expect(sessions.map((s) => s.fileHash)).toEqual([HASH_B, HASH_A])
    expect(at(sessions, 0)).not.toHaveProperty('payload')
    expect(at(sessions, 0).fileName).toBe('second.csv')
  })

  it('drops a session untouched for 30 days when the list is read', async () => {
    await save(cookie, HASH_A)
    await save(cookie, HASH_B)
    await db
      .update(importSessions)
      .set({ updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(importSessions.fileHash, HASH_A))

    expect((await list(cookie)).map((s) => s.fileHash)).toEqual([HASH_B])
    expect((await read(cookie, HASH_A)).status).toBe(404)
  })

  it(`keeps the ${MAX_SESSIONS} most recently saved`, async () => {
    const hashes = Array.from({ length: MAX_SESSIONS + 2 }, (_, i) =>
      i.toString(16).padStart(64, '0'),
    )
    for (const hash of hashes) await save(cookie, hash)

    const kept = (await list(cookie)).map((s) => s.fileHash)
    expect(kept).toHaveLength(MAX_SESSIONS)
    expect(kept).not.toContain(hashes[0])
    expect(kept).not.toContain(hashes[1])
    expect(kept).toContain(at(hashes, MAX_SESSIONS + 1))
  })

  it('deletes a session, and answers 204 for one that is already gone', async () => {
    await save(cookie, HASH_A)
    const first = await request(`/api/import/sessions/${HASH_A}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(first.status).toBe(204)
    expect((await read(cookie, HASH_A)).status).toBe(404)

    const again = await request(`/api/import/sessions/${HASH_A}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(again.status).toBe(204)
  })

  it("never shows or deletes another user's session", async () => {
    await save(cookie, HASH_A)
    const other = await createTestUser('other@example.com')

    expect(await list(other)).toEqual([])
    expect((await read(other, HASH_A)).status).toBe(404)
    await request(`/api/import/sessions/${HASH_A}`, {
      method: 'DELETE',
      headers: { Cookie: other },
    })
    expect((await read(cookie, HASH_A)).status).toBe(200)

    // The same file saved by both is two sessions, not one overwritten.
    await save(other, HASH_A, { ...SESSION, fileName: 'theirs.csv' })
    const mine = (await (await read(cookie, HASH_A)).json()) as { fileName: string }
    expect(mine.fileName).toBe('statement.csv')
  })

  it('answers 404 for a file hash that is not one', async () => {
    const res = await read(cookie, 'not-a-hash')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('IMPORT_SESSION_NOT_FOUND')
  })

  it('refuses a malformed session', async () => {
    const badHash = await save(cookie, 'nope')
    expect(badHash.status).toBe(400)

    for (const body of [
      { ...SESSION, payload: 'a string' },
      { ...SESSION, payload: [] },
      { ...SESSION, rowCount: -1 },
      { ...SESSION, version: 1.5 },
      { ...SESSION, fileName: '' },
      { ...SESSION, lastError: 'a sentence' },
    ]) {
      expect((await save(cookie, HASH_A, body)).status).toBe(400)
    }
    expect(await list(cookie)).toEqual([])
  })

  it('refuses a session over the size limit before reading it', async () => {
    const res = await save(cookie, HASH_A, {
      ...SESSION,
      payload: { padding: 'x'.repeat(5 * 1024 * 1024) },
    })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toBe('IMPORT_SESSION_TOO_LARGE')
    expect(await list(cookie)).toEqual([])
  })

  it('needs a signed-in user', async () => {
    const res = await request('/api/import/sessions')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/import/commit with a session', () => {
  let cookie: string
  let checking: string
  let food: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    checking = await account(cookie, 'assets:checking')
    food = await account(cookie, 'expenses:food')
  })

  const row = (amount: string) => ({
    isTransfer: false,
    date: '2026-02-01T00:00:00.000Z',
    amount,
    description: 'Coffee',
    offsetAccountId: food,
  })

  it('deletes the session it names when the rows are written', async () => {
    await save(cookie, HASH_A)
    await save(cookie, HASH_B)

    const res = await commit(cookie, {
      accountId: checking,
      defaultCurrency: 'CAD',
      transactions: [row('-4.50')],
      session: HASH_A,
    })
    expect(res.status).toBe(201)
    expect((await read(cookie, HASH_A)).status).toBe(404)
    // Only the one it names.
    expect((await read(cookie, HASH_B)).status).toBe(200)
  })

  it('keeps the session, and writes nothing, when a row is refused', async () => {
    await save(cookie, HASH_A)

    const res = await commit(cookie, {
      accountId: checking,
      defaultCurrency: 'CAD',
      // The second row's amount is refused as the ledger service writes it, after the first
      // row has been written in the same transaction.
      transactions: [row('-4.50'), row('1,234.56')],
      session: HASH_A,
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('AMOUNT_INVALID')
    expect((await read(cookie, HASH_A)).status).toBe(200)
    expect(await db.select().from(transactions)).toEqual([])
  })

  it('keeps the session when the request is refused before anything is written', async () => {
    await save(cookie, HASH_A)
    const res = await commit(cookie, {
      accountId: checking,
      defaultCurrency: 'CAD',
      transactions: [{ ...row('-4.50'), offsetAccountId: undefined }],
      session: HASH_A,
    })
    expect(res.status).toBe(400)
    expect((await read(cookie, HASH_A)).status).toBe(200)
  })

  it("does not touch another user's session of the same file", async () => {
    const other = await createTestUser('other@example.com')
    await save(other, HASH_A)

    const res = await commit(cookie, {
      accountId: checking,
      defaultCurrency: 'CAD',
      transactions: [row('-4.50')],
      session: HASH_A,
    })
    expect(res.status).toBe(201)
    expect((await read(other, HASH_A)).status).toBe(200)
  })

  it('commits as before without a session, and refuses one that is not a file hash', async () => {
    const plain = await commit(cookie, {
      accountId: checking,
      defaultCurrency: 'CAD',
      transactions: [row('-4.50')],
    })
    expect(plain.status).toBe(201)

    const bad = await commit(cookie, {
      accountId: checking,
      defaultCurrency: 'CAD',
      transactions: [row('-4.50')],
      session: 'nope',
    })
    expect(bad.status).toBe(400)
  })
})
