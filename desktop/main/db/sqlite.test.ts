import { failure } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { expect, test } from 'vitest'

// `bun run test` starts vitest under Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), so these
// load the better-sqlite3 binary the packaged app will load. Under the system's Node they would
// pass and prove nothing, which is what the first test is for.
test("the tests run on Electron's Node, not the system's", () => {
  expect(process.versions.electron).toMatch(/^\d+\.\d+\.\d+/)
})

test('better-sqlite3 opens a database and writes to it in a transaction', () => {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE note (body TEXT NOT NULL)')
    const insert = db.prepare('INSERT INTO note (body) VALUES (?)')
    db.transaction((bodies: string[]) => {
      for (const body of bodies) insert.run(body)
    })(['one', 'two'])

    expect(db.prepare('SELECT count(*) AS n FROM note').get()).toEqual({ n: 2 })
  } finally {
    db.close()
  }
})

test('a failed transaction leaves nothing behind', () => {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE note (body TEXT NOT NULL)')
    const insert = db.prepare('INSERT INTO note (body) VALUES (?)')
    const write = db.transaction((bodies: (string | null)[]) => {
      for (const body of bodies) insert.run(body)
    })

    expect(() => write(['one', null])).toThrow(/NOT NULL/)
    expect(db.prepare('SELECT count(*) AS n FROM note').get()).toEqual({ n: 0 })
  } finally {
    db.close()
  }
})

test('the core resolves as a workspace package', () => {
  expect(failure('PATH_INVALID', { path: 'x' })).toEqual({
    ok: false,
    failure: { code: 'PATH_INVALID', details: { path: 'x' } },
  })
})
