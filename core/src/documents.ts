import { z } from 'zod'
import { ACCOUNT_KINDS, rootOf } from './account-kind'
import { isValidPath } from './account-path'
import { isCalendarDate } from './calendar-date'
import { isValidCurrency } from './currencies'
import { firstIssue } from './first-issue'
import { cents, format } from './money'
import type { Outcome } from './outcome'
import { failure } from './outcome'
import { validatePostings } from './postings'
import { MAX_WALL_MS, VersionSchema } from './version'

/** UTC ms, 1970 to the end of 9999, like a version's time. */
const utcMs = z.int().min(0).max(MAX_WALL_MS)

/** Text SQLite stores as written: half of a surrogate pair would come back as `�`. */
const text = z.stringFormat('well_formed', (s) => s.isWellFormed())

// Who made the document and when. Set once: an edit carries it through unchanged.
const made = {
  /** UTC ms. The document's creation, never a later edit's. */
  createdAt: utcMs,
  /** The maker's device, never a later editor's. */
  deviceId: VersionSchema.shape.deviceId,
}

const ManualOrigin = z.strictObject({ source: z.literal('manual'), ...made })

/** Made by the app itself: the default wallet, equity accounts. */
const SystemOrigin = z.strictObject({ source: z.literal('system'), ...made })

/** One line of a bank statement. One import's documents share `createdAt`. */
const ImportOrigin = z.strictObject({
  source: z.literal('import'),
  ...made,
  /** The file's name as picked, not its path. */
  file: text.min(1),
  /** As an editor numbers it: from 1, with the header and anything above it counted. */
  line: z.int().min(1),
  /** The description as the bank wrote it. */
  text,
})

export const TransactionOriginSchema = z.discriminatedUnion('source', [
  ManualOrigin,
  ImportOrigin,
  SystemOrigin,
])
export type TransactionOrigin = z.infer<typeof TransactionOriginSchema>
export type OriginSource = TransactionOrigin['source']

/** Nothing imports accounts. */
export const AccountOriginSchema = z.discriminatedUnion('source', [ManualOrigin, SystemOrigin])
export type AccountOrigin = z.infer<typeof AccountOriginSchema>

export const PostingSchema = z.strictObject({
  accountId: z.uuid(),
  amount: z.string(),
  currency: z.string(),
})
export type PostingDoc = z.infer<typeof PostingSchema>

export const TransactionSchema = z.strictObject({
  type: z.literal('transaction'),
  id: z.uuid(),
  date: z.string(),
  description: text,
  postings: z.array(PostingSchema),
  deletedAt: utcMs.nullable(),
  origin: TransactionOriginSchema,
})
export type TransactionDoc = z.infer<typeof TransactionSchema>

export const AccountSchema = z.strictObject({
  type: z.literal('account'),
  id: z.uuid(),
  path: text,
  kind: z.enum(ACCOUNT_KINDS),
  /** The one currency its postings carry, or null for any. */
  currency: z.string().nullable(),
  deletedAt: utcMs.nullable(),
  origin: AccountOriginSchema,
})
export type AccountDoc = z.infer<typeof AccountSchema>

export const DocumentSchema = z.discriminatedUnion('type', [TransactionSchema, AccountSchema])
export type LedgerDocument = z.infer<typeof DocumentSchema>

export function readShape(input: unknown): Outcome<LedgerDocument> {
  const result = DocumentSchema.safeParse(input)
  if (!result.success) return failure('DOCUMENT_MALFORMED', firstIssue(result.error))
  return { ok: true, value: result.data }
}

function canonicalize(doc: TransactionDoc): TransactionDoc {
  const canonicalPostings = doc.postings.map((p) => ({ ...p, amount: format(cents(p.amount)) }))
  return { ...doc, postings: canonicalPostings }
}

/*
 * A transaction must:
 * - have a valid date
 * - have no postings, if deletedAt is set
 * - if not deleted, must have a set of valid postings
 */
function checkTransaction(doc: TransactionDoc): Outcome<void> {
  if (!isCalendarDate(doc.date)) {
    return failure('DATE_INVALID', { date: doc.date })
  }

  if (doc.deletedAt !== null) {
    if (doc.postings.length > 0) {
      return failure('TOMBSTONE_HAS_POSTINGS')
    }
  } else {
    const postingsCheck = validatePostings(doc.postings)
    if (!postingsCheck.ok) return postingsCheck
  }
  return { ok: true, value: undefined }
}

/*
 * An account must:
 * - have a valid path
 * - have path root matched with the kind of account
 * - be locked to a supported currency, if locked at all
 */
function checkAccount(doc: AccountDoc): Outcome<void> {
  if (!isValidPath(doc.path)) {
    return failure('PATH_INVALID', { path: doc.path })
  }

  const [root] = doc.path.split(':')
  const expected = rootOf(doc.kind)

  if (expected !== root) {
    return failure('PATH_ROOT_MISMATCH', {
      path: doc.path,
      kind: doc.kind,
      expected,
    })
  }

  if (doc.currency !== null && !isValidCurrency(doc.currency)) {
    return failure('UNSUPPORTED_CURRENCY', { currency: doc.currency })
  }
  return { ok: true, value: undefined }
}

export function readDocument(input: unknown): Outcome<LedgerDocument> {
  const shape = readShape(input)
  if (!shape.ok) return shape
  return checked(shape.value.type, shape.value)
}

// Generic over the type, so indexing the table by a union type-checks.
const checked = <T extends DocumentTypeName>(type: T, doc: DocumentOf<T>) =>
  DOCUMENT_TYPES[type].check(doc)

export type DocumentTypeName = LedgerDocument['type']
export type DocumentOf<T extends DocumentTypeName> = Extract<LedgerDocument, { type: T }>

/** One type of document. A new type is a schema in DocumentSchema and an entry below. */
export type DocumentType<D extends LedgerDocument> = {
  /** Its checks, and its canonical form. */
  check(doc: D): Outcome<D>
  /** Lower applies first in a batch, and is sent first. */
  rank: number
  /** The document deleted at `now`, with anything a tombstone can't hold taken off. */
  tombstone(doc: D, now: number): D
}

export const DOCUMENT_TYPES: { [T in DocumentTypeName]: DocumentType<DocumentOf<T>> } = {
  account: {
    check: (doc) => {
      const result = checkAccount(doc)
      return result.ok ? { ok: true, value: doc } : result
    },
    rank: 0,
    tombstone: (doc, now) => ({ ...doc, deletedAt: now }),
  },
  transaction: {
    check: (doc) => {
      const result = checkTransaction(doc)
      return result.ok ? { ok: true, value: canonicalize(doc) } : result
    },
    rank: 1,
    tombstone: (doc, now) => ({ ...doc, postings: [], deletedAt: now }),
  },
}
