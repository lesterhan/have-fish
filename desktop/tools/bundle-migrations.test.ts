import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { MIGRATIONS } from '../main/db/migrations'
import { DRIZZLE, readMigrations } from './bundle-migrations'

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'havefish-drizzle-'))
  mkdirSync(join(folder, 'meta'))
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

test('reads migrations in journal order, one statement per breakpoint', () => {
  // The journal, not the file names, says the order.
  const entries = [{ tag: '0001_b' }, { tag: '0000_a' }]
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ entries }))
  writeFileSync(join(folder, '0001_b.sql'), 'CREATE TABLE b (x);\n')
  writeFileSync(
    join(folder, '0000_a.sql'),
    'CREATE TABLE a (x);\n--> statement-breakpoint\nCREATE INDEX a_x ON a (x);\n--> statement-breakpoint\n',
  )

  expect(readMigrations(folder)).toEqual([
    { tag: '0001_b', statements: ['CREATE TABLE b (x);'] },
    { tag: '0000_a', statements: ['CREATE TABLE a (x);', 'CREATE INDEX a_x ON a (x);'] },
  ])
})

test('the bundled migrations are the ones in drizzle/', () => {
  expect(MIGRATIONS, 'run `bun run db:bundle`').toEqual(readMigrations(DRIZZLE))
})
