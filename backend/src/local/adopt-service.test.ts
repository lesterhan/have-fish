// `havefish --adopt <file>` (#289): what it takes, what it refuses, and that a refusal leaves
// the data directory exactly as it was. Files only, through libsql directly, so it runs the
// same in both suites; `launch.test.ts` drives it from the command line.

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrateSqliteFile, readMigrations } from '../db/sqlite/migrate'
import * as lite from '../db/sqlite/schema'
import { AdoptRefused, adoptLedger } from './adopt-service'
import { dataPaths } from './data-dir'

const root = mkdtempSync(join(tmpdir(), 'havefish-adopt-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const migrations = readMigrations()

let dir: string
let paths: ReturnType<typeof dataPaths>
let n = 0
beforeEach(() => {
  dir = join(root, `case-${++n}`)
  mkdirSync(dir, { recursive: true })
  paths = dataPaths(dir)
})

/** A ledger file as the export writes one: an owner, a profile, and `entries` transactions. */
async function ledger(path: string, name: string, entries: number): Promise<string> {
  await migrateSqliteFile(path, migrations)
  const client = createClient({ url: `file:${path}` })
  try {
    const db = drizzle(client, { schema: lite })
    const id = crypto.randomUUID()
    const now = new Date()
    await db.insert(lite.user).values({
      id,
      name,
      email: `${name}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(lite.localProfile).values({ userId: id })
    for (let i = 0; i < entries; i++) {
      await db.insert(lite.transactions).values({ userId: id, date: '2026-08-01' })
    }
    return id
  } finally {
    client.close()
  }
}

async function ownerOf(path: string): Promise<string | undefined> {
  const client = createClient({ url: `file:${path}` })
  try {
    const [row] = await drizzle(client, { schema: lite }).select().from(lite.localProfile)
    return row?.userId
  } finally {
    client.close()
  }
}

describe('adopting a ledger', () => {
  it('puts it in an empty data directory, and leaves the original where it was', async () => {
    const source = join(root, `yours-${n}.sqlite`)
    const you = await ledger(source, 'you', 2)

    expect(await adoptLedger(source, paths, migrations)).toEqual({ backup: null })
    expect(await ownerOf(paths.database)).toBe(you)
    expect(await ownerOf(source)).toBe(you)
    expect(readdirSync(dir)).toEqual(['havefish.sqlite'])
  })

  it('replaces a fresh install, and keeps a copy of it in backups', async () => {
    const fresh = await ledger(paths.database, 'fresh', 0)
    writeFileSync(`${paths.database}-wal`, 'what the old file had not folded in yet')
    const source = join(root, `yours-${n}.sqlite`)
    const you = await ledger(source, 'you', 1)

    const { backup } = await adoptLedger(source, paths, migrations, new Date('2026-09-29T10:00Z'))
    expect(backup).toBe(join(paths.backups, 'pre-adopt-2026-09-29T10-00-00-000Z.sqlite'))
    expect(await ownerOf(backup ?? '')).toBe(fresh)
    expect(await ownerOf(paths.database)).toBe(you)
    // The old file's WAL would replay into the new one.
    expect(existsSync(`${paths.database}-wal`)).toBe(false)
  })

  describe('refuses, and changes nothing', () => {
    async function refused(source: string, message: RegExp | string) {
      const before = existsSync(paths.database) ? await ownerOf(paths.database) : undefined
      await expect(adoptLedger(source, paths, migrations)).rejects.toThrow(AdoptRefused)
      await expect(adoptLedger(source, paths, migrations)).rejects.toThrow(message)
      expect(existsSync(paths.database) ? await ownerOf(paths.database) : undefined).toBe(before)
      expect(existsSync(`${paths.database}.adopting`)).toBe(false)
      expect(existsSync(paths.backups)).toBe(false)
    }

    it('a ledger someone has already entered transactions into', async () => {
      await ledger(paths.database, 'partner', 3)
      const source = join(root, `yours-${n}.sqlite`)
      await ledger(source, 'you', 1)
      await refused(source, 'already has 3 transaction(s)')
    })

    it('a file that is not there', async () => {
      await refused(join(root, 'nowhere.sqlite'), 'there is no file')
    })

    it('a file that is not a database', async () => {
      const source = join(root, `notes-${n}.txt`)
      writeFileSync(source, 'groceries: 40\n'.repeat(200))
      await refused(source, 'not a have-fish ledger')
    })

    it('a database that is not a ledger', async () => {
      const source = join(root, `other-${n}.sqlite`)
      const client = createClient({ url: `file:${source}` })
      await client.execute('CREATE TABLE notes (body text)')
      client.close()
      await refused(source, 'not a have-fish ledger')
    })

    it('a ledger with no owner', async () => {
      const source = join(root, `ownerless-${n}.sqlite`)
      await migrateSqliteFile(source, migrations)
      await refused(source, 'it has no owner')
    })

    it('a ledger a newer have-fish wrote', async () => {
      const source = join(root, `newer-${n}.sqlite`)
      await ledger(source, 'you', 1)
      const client = createClient({ url: `file:${source}` })
      await client.execute("INSERT INTO __migrations VALUES ('9999_from_the_future', 0)")
      client.close()
      await refused(source, 'newer have-fish')
    })
  })
})
