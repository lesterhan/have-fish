// A document travels with its version, in an envelope: `{ doc, version }`. This is what the
// apply path takes, and later what sync sends and receives.
//
// The version travels as an object, the same `Version` the clock hands out, so an envelope
// survives `JSON.stringify` and reads back equal. The text form (`formatVersion`) is for
// storage and logs.

import { z } from 'zod'
import { type LedgerDocument, readDocument } from './documents'
import { failure, type Outcome } from './outcome'
import { type Version, VersionSchema } from './version'

export type Versioned<D extends LedgerDocument = LedgerDocument> = { doc: D; version: Version }

// The document is checked separately by `readDocument`, so its own failures keep their codes.
const EnvelopeSchema = z.strictObject({ doc: z.unknown(), version: VersionSchema })

/**
 * Reads an envelope: the version first, then the document. A bad envelope or version is
 * `VERSION_MALFORMED`, with the path to the field at fault; a bad document is whatever
 * `readDocument` says.
 */
export function readVersioned(input: unknown): Outcome<Versioned> {
  const result = EnvelopeSchema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    if (issue === undefined) return failure('VERSION_MALFORMED', { path: '', issue: 'unknown' })
    const path =
      issue.code === 'unrecognized_keys' ? [...issue.path, issue.keys[0]] : [...issue.path]
    return failure('VERSION_MALFORMED', { path: path.join('.'), issue: issue.code })
  }

  const doc = readDocument(result.data.doc)
  if (!doc.ok) return doc
  return { ok: true, value: { doc: doc.value, version: result.data.version } }
}
