// A document with its version: what the apply path and sync accept. The version is an object,
// not text, so an envelope survives a JSON round trip unchanged.

import { z } from 'zod'
import { type LedgerDocument, readDocument } from './documents'
import { firstIssue } from './first-issue'
import { failure, type Outcome } from './outcome'
import { type Version, VersionSchema } from './version'

export type Versioned<D extends LedgerDocument = LedgerDocument> = { doc: D; version: Version }

// `doc` is left to `readDocument`, so its failures keep their own codes.
const EnvelopeSchema = z.strictObject({ doc: z.unknown(), version: VersionSchema })

/** A bad envelope or version is `VERSION_MALFORMED`; a bad document is `readDocument`'s code. */
export function readVersioned(input: unknown): Outcome<Versioned> {
  const result = EnvelopeSchema.safeParse(input)
  if (!result.success) return failure('VERSION_MALFORMED', firstIssue(result.error))

  const doc = readDocument(result.data.doc)
  if (!doc.ok) return doc
  return { ok: true, value: { doc: doc.value, version: result.data.version } }
}
