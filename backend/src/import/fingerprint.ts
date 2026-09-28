import { sha1 } from '@noble/hashes/legacy.js'
import { sha256 as sha256Bytes } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import type { ParsedTransaction } from './types'

// Which bank row an imported transaction came from, as two hashes (#282, decided in #460).
//
//   row key       at preview, from the file alone: the parser, the row's kind, date, every
//                 amount and currency it carries, its description with whitespace and case
//                 normalised, and how many identical rows came before it in the file. So
//                 two identical coffees on one day are two rows, and re-reading the same
//                 file gives the same keys.
//   fingerprint   at commit: the row key bound to the account the file describes (the
//                 statement account, `statementAccountId` in commit-plan.ts), so two
//                 accounts that share a CSV layout never mark each other's rows as imported.
//
// The transaction's id is a UUIDv5 of the fingerprint, scoped to the user, so a device that
// imports the same row mints the same id (planning/epics/sync-unit.md).
//
// Every value here is derived from transaction content. It is a local convergence device:
// it never leaves the device in the clear, and a sync relay never gets it as a column
// (#375). The row key only travels between this backend and its own frontend.
//
// Changing anything below changes every key, and statements imported before the change
// stop matching. Change it only by bumping VERSION on purpose.
//
// The hashes are pure JavaScript (`@noble/hashes`), synchronous and with no `node:crypto` or
// `Buffer`, so a phone mints the same keys as this server (#474). They replaced
// `node:crypto` byte for byte; `fingerprint.test.ts` holds the two to the same output.

const VERSION = 'import-fingerprint/v1'

/** A fixed namespace for have-fish import ids, minted once. Never change it. */
const ID_NAMESPACE = 'e788c43d-d22f-43f1-8d0d-3922a1b0bf78'

/** A row key or fingerprint: 64 lower-case hex digits. */
export const IMPORT_KEY = /^[0-9a-f]{64}$/

/** A description as the key reads it: NFC, trimmed, runs of whitespace as one space, lower case. */
export function normaliseDescription(description: string | undefined): string {
  return (description ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** What identifies a parsed row, before its position among identical rows. */
function content(parserId: string, t: ParsedTransaction): string[] {
  const description = normaliseDescription(t.description)
  if (t.isTransfer === true) {
    return [
      parserId,
      'transfer',
      t.date,
      t.sourceAmount,
      t.sourceCurrency,
      t.targetAmount,
      t.targetCurrency,
      t.feeAmount ?? '',
      t.feeCurrency ?? '',
      description,
    ]
  }
  if (t.isTransfer === 'same-currency') {
    return [parserId, 'same-currency', t.date, t.amount, t.feeAmount, t.currency, description]
  }
  return [parserId, 'regular', t.date, t.amount, t.currency ?? '', description]
}

/**
 * The row key of each parsed row, in order. `rows` must be the whole file as parsed, not a
 * selection of it: a row's position among identical rows is part of its key.
 */
export function rowKeys(parserId: string, rows: readonly ParsedTransaction[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((t) => {
    const identity = JSON.stringify(content(parserId, t))
    const occurrence = seen.get(identity) ?? 0
    seen.set(identity, occurrence + 1)
    return sha256([VERSION, identity, String(occurrence)])
  })
}

/** The fingerprint a transaction is stored with: a row key bound to its statement account. */
export function importFingerprint(statementAccountId: string, rowKey: string): string {
  return sha256([VERSION, statementAccountId, rowKey])
}

/** The id of the transaction a fingerprint imports as, the same on every device. */
export function importTransactionId(userId: string, fingerprint: string): string {
  return uuidv5(ID_NAMESPACE, `${userId}\n${fingerprint}`)
}

function sha256(parts: string[]): string {
  return bytesToHex(sha256Bytes(utf8ToBytes(JSON.stringify(parts))))
}

/** RFC 9562 UUIDv5: SHA-1 of the namespace's bytes and the name, stamped version 5. */
export function uuidv5(namespace: string, name: string): string {
  const hash = sha1
    .create()
    .update(hexToBytes(namespace.replace(/-/g, '')))
    .update(utf8ToBytes(name))
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
