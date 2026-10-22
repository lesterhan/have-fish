import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { type Ledger, type OpenOptions, openLedger } from './ledger'

// Each test gets a fresh temp folder, deleted afterwards.
let root: string
const opened: Ledger[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'havefish-ledger-'))
})

afterEach(() => {
  for (const ledger of opened.splice(0)) ledger.close()
  rmSync(root, { recursive: true, force: true })
})

/** Opens a ledger that is closed after the test. A refusal fails the test. */
function open(options: OpenOptions): Ledger {
  const result = openLedger(options)
  if (!result.ok) throw new Error(`refused: ${result.failure.code}`)
  opened.push(result.value)
  return result.value
}

test('makes a missing directory, readable by you alone', () => {
  const dir = join(root, 'ledger')
  open({ dir })
  expect(statSync(dir).mode & 0o777).toBe(0o700)
})

test('tightens permission of existing directory to readable by you alone', () => {
  const dir = join(root, 'ledger')
  mkdirSync(dir, { recursive: true, mode: 0o755 })
  open({ dir })
  expect(statSync(dir).mode & 0o777).toBe(0o700)
})

test('creates a ledger db file', () => {
  const dir = join(root, 'ledger')
  open({ dir })
  expect(existsSync(join(dir, 'ledger.sqlite'))).toBeTruthy()
})
