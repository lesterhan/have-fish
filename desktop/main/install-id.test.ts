import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { readOrCreateInstallId } from './install-id'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'havefish-install-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

test('the first call writes a new id to a file only you can read', () => {
  const id = readOrCreateInstallId(root)
  const file = join(root, 'install-id')
  expect(id).toMatch(UUID)
  expect(readFileSync(file, 'utf8').trim()).toBe(id)
  expect(statSync(file).mode & 0o777).toBe(0o600)
})

test('later calls return the same id, and leave the file as it was', () => {
  const id = readOrCreateInstallId(root)
  const before = readFileSync(join(root, 'install-id'))

  expect(readOrCreateInstallId(root)).toBe(id)
  expect(readFileSync(join(root, 'install-id')).equals(before)).toBe(true)
})

test('two installs get different ids', () => {
  expect(readOrCreateInstallId(join(root, 'a'))).not.toBe(readOrCreateInstallId(join(root, 'b')))
})

test('a missing config folder is made, readable by you alone', () => {
  const config = join(root, 'not', 'yet')
  readOrCreateInstallId(config)
  expect(statSync(config).mode & 0o777).toBe(0o700)
})

test('a file that holds no id is replaced, and made private', () => {
  const file = join(root, 'install-id')
  writeFileSync(file, '', { mode: 0o644 })

  const id = readOrCreateInstallId(root)

  expect(id).toMatch(UUID)
  expect(readFileSync(file, 'utf8').trim()).toBe(id)
  expect(statSync(file).mode & 0o777).toBe(0o600)
})
