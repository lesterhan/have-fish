// This install's id. It lives in the config folder, never beside the ledger, so a copied ledger
// meets a different id and knows to take a new device id.

import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const INSTALL_ID_FILE = 'install-id'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Reads `configDir/install-id`, or writes a new one. A file that holds no id is replaced: a new
 * install id only gives each ledger a new device id, which is always safe.
 */
export function readOrCreateInstallId(configDir: string): string {
  const path = join(configDir, INSTALL_ID_FILE)
  const existing = readIfThere(path)
  if (existing !== undefined && UUID.test(existing)) return existing

  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  writeFileSync(path, `${id}\n`, { mode: 0o600 })
  // `mode` applies only when the file is new.
  chmodSync(path, 0o600)
  return id
}

function readIfThere(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
}
