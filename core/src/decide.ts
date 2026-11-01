// Last write wins: which of two versions of one document the ledger keeps.

import { compareVersions, type Version } from './version'

/**
 * `write` when nothing is stored or the incoming version is newer; `same` when it's the same
 * event arriving twice; `stale` when the stored one is newer.
 */
export function decide(stored: Version | null, incoming: Version): 'write' | 'same' | 'stale' {
  if (stored === null) return 'write'
  const order = compareVersions(stored, incoming)
  if (order < 0) return 'write'
  return order === 0 ? 'same' : 'stale'
}
