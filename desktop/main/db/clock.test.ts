import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { loadClock, saveClock } from './clock'
import { type Ledger, openLedger } from './ledger'
import { migrate } from './migrate'
import { MIGRATIONS } from './migrations'

const NOW = Date.UTC(2026, 9, 22, 12)

let dir: string
const opened: Ledger[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'havefish-clock-'))
})

afterEach(() => {
  for (const ledger of opened.splice(0)) ledger.close()
  rmSync(dir, { recursive: true, force: true })
})

function open(): Ledger {
  const result = openLedger({ dir, installId: 'install-a', now: NOW })
  if (!result.ok) throw new Error(`refused: ${result.failure.code}`)
  opened.push(result.value)
  return result.value
}

test("a new ledger's clock is zero", () => {
  expect(loadClock(open().db)).toEqual({ wallMs: 0, counter: 0 })
})

test('a saved clock is there after a reopen', () => {
  const ledger = open()
  saveClock(ledger.db, { wallMs: NOW, counter: 7 })
  ledger.close()

  expect(loadClock(open().db)).toEqual({ wallMs: NOW, counter: 7 })
})

test('saving the clock leaves the ids alone', () => {
  const ledger = open()
  saveClock(ledger.db, { wallMs: NOW, counter: 7 })
  ledger.close()

  expect(open().meta).toEqual(ledger.meta)
})

test('a file with no meta row has no clock to load', () => {
  const db = new Database(':memory:')
  migrate(db, MIGRATIONS, NOW, join(dir, 'backups'))
  expect(() => loadClock(db)).toThrow('no meta row')
  db.close()
})
