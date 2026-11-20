// A rate's id, derived from its source, day and pair: one rate per day, pair and source, so the
// day's rate typed again, either way round, is a new version of the same document.

import { createHash } from 'node:crypto'
import type { RateDoc } from '@have-fish/core/documents'

// Changing it changes every rate's id.
const RATE_NAMESPACE = '1ba2c18c-1256-45ae-8e81-107659b23f02'

/** A UUID v5 (RFC 9562) of `<source>:<date>:<the two codes sorted>`. */
export function rateId(rate: Pick<RateDoc, 'date' | 'from' | 'to' | 'origin'>): string {
  const name = `${rate.origin.source}:${rate.date}:${[rate.from, rate.to].sort().join(':')}`
  const bytes = createHash('sha1')
    .update(Buffer.from(RATE_NAMESPACE.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6) // version 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8) // RFC variant
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
