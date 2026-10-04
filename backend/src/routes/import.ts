import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { commitImport } from '../import/commit-service'
import { findPossibleDuplicates } from '../import/duplicates-service'
import { IMPORT_KEY } from '../import/fingerprint'
import { previewImport } from '../import/preview-service'
import { deleteSession, listSessions, readSession, saveSession } from '../import/session-service'
import { fail, failWith } from '../respond'
import { amountLike, as, asField, parseBody, text } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

// A session is named by the sha-256 of its CSV, as the page computes it (`hashCsv`).
const FILE_HASH = /^[0-9a-f]{64}$/

// POST /api/import/preview
// Parses an uploaded CSV using the user's saved parser that matches the file's
// column fingerprint. Returns what would be imported — no DB writes.
//
// Request: multipart/form-data
//   file            (File)   — the CSV file from the bank
//   defaultCurrency (string) — fallback currency for rows that don't include one
//
// Response: { parser: string, defaultAccountId: string|null, transactions: ParsedTransaction[], errors: ParseError[] }
// Error 422: no saved parser matched this CSV's columns
app.post('/preview', async (c) => {
  const userId = c.get('userId')
  const form = await c.req.formData()
  const file = form.get('file')
  const defaultCurrency = form.get('defaultCurrency')

  if (!file || typeof file === 'string') return fail(c, 'FIELD_REQUIRED', { field: 'file' })
  if (!defaultCurrency || typeof defaultCurrency !== 'string')
    return fail(c, 'FIELD_REQUIRED', { field: 'defaultCurrency' })

  const preview = await previewImport(userId, await file.text())
  if (!preview.ok) return failWith(c, preview.failure)
  return c.json(preview.value)
})

// POST /api/import/check-duplicates
// Checks a list of rows (each with a resolved accountId, date, and amount)
// against existing postings. Used by the frontend for multi-currency imports
// where each row maps to a different sub-account (e.g. assets:wise:usd) that
// the /preview endpoint cannot know about until the frontend resolves them.
//
// Request body: { rows: [{ accountId, date, amount, currency }] }
// Response: { duplicates: (PossibleDuplicate | null)[] }
//   where PossibleDuplicate = { transactionId, date, amount, currency } plus, when the
//   match was entered through Fish Pie, fishPieKind ('expense' | 'settlement') and the
//   group's id and name
//
// A match needs the same currency as well as the same account, ±1 day and |amount|
// within 0.01: 8,400 JPY and 8,400 CAD are not the same purchase. A row that sends its
// `importKey` and `importAccountId` is also checked by fingerprint, and a match there comes
// back with `certain: true`, whatever the guess said.

// A row the caller has already resolved to an account. An empty `accountId` is how the
// frontend marks a transfer row, which this endpoint does not check — hence the empty
// string alongside the uuid rather than a bare `z.uuid()`.
const DuplicateCheckRow = z.object({
  accountId: z.union([z.literal(''), z.uuid()], { error: asField('FIELD_NOT_UUID') }),
  date: z.string({ error: asField('FIELD_NOT_DATE') }),
  amount: amountLike,
  currency: z.string(),
  // For the certain check (#282): the row key the preview gave the row, and its statement
  // account as commit will decide it (`statementAccountId` in import/commit-plan.ts).
  importKey: z
    .string({ error: asField('FIELD_INVALID') })
    .regex(IMPORT_KEY, { error: asField('FIELD_INVALID') })
    .optional(),
  importAccountId: z.string({ error: asField('FIELD_NOT_STRING') }).optional(),
})

const CheckDuplicates = z.object({ rows: z.array(DuplicateCheckRow) })

app.post('/check-duplicates', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, CheckDuplicates)
  if (!parsed.ok) return parsed.response
  return c.json({ duplicates: await findPossibleDuplicates(userId, parsed.data.rows) })
})

// POST /api/import/commit
// Writes a set of pre-parsed transactions to the database, all or none. The order of the
// checks is in `import/commit-service.ts`, and the legs each row becomes are in
// `import/commit-plan.ts`.
//
// Request body (JSON):
//   accountId       — UUID of the source account for regular rows;
//                     may be empty string for multi-currency-only imports
//   defaultCurrency — fallback currency for regular rows missing a currency field
//   transactions    — array of CommitRow, one per parsed CSV row
//
// Regular row shape:   { isTransfer: false, date, amount, description?, currency?,
//                        offsetAccountId, sourceAccountId? }
// Transfer row shape:  { isTransfer: true, date, description?,
//                        sourceAmount, sourceCurrency, targetAmount, targetCurrency,
//                        feeAmount?, feeCurrency?,
//                        sourceAccountId, targetAccountId, conversionAccountId, feeAccountId }
//
// Response: { created: number, skipped: number, fishPieExpenses: number }
//   skipped — rows whose fingerprint the ledger already holds (#282), not written

// One imported row, with every field it can carry typed.
//
// Which fields a row *must* carry depends on its kind and on what else the request said —
// a Fish Pie split supplies the accounts a plain row would have to name — so `checkRows`
// in `import/commit-plan.ts` is what decides that, and answers `IMPORT_ROW_MISSING_ACCOUNT` with the row
// kind and the field. What the schema settles is that every value present is the type the
// posting builders read it as, which is the part that used to be assumed.
const ImportRow = z.looseObject({
  isTransfer: z
    .union([z.boolean(), z.literal('cross-currency-spend'), z.literal('same-currency')])
    .optional(),
  date: z.string({ error: asField('FIELD_NOT_DATE') }),
  description: z.string().nullish(),

  amount: z.string().optional(),
  currency: z.string().optional(),
  sourceAmount: z.string().optional(),
  sourceCurrency: z.string().optional(),
  targetAmount: z.string().optional(),
  targetCurrency: z.string().optional(),
  feeAmount: z.string().optional(),
  feeCurrency: z.string().optional(),

  offsetAccountId: z.string().optional(),
  sourceAccountId: z.string().optional(),
  targetAccountId: z.string().optional(),
  conversionAccountId: z.string().optional(),
  expenseAccountId: z.string().optional(),
  feeAccountId: z.string().optional(),

  // The row key the preview gave this row. Present, the row is fingerprinted and skipped
  // if it was imported before; absent, it is written as a new transaction.
  importKey: z
    .string({ error: asField('FIELD_INVALID') })
    .regex(IMPORT_KEY, { error: asField('FIELD_INVALID') })
    .optional(),
})

const malformedSplit = as('GROUP_SPLIT_MALFORMED')

const GroupSplitInput = z.object({
  rowIndex: z.number({ error: malformedSplit }),
  groupId: z.string({ error: malformedSplit }),
  categoryId: z.string().nullish(),
})

const emptyBatch = as('FIELD_EMPTY', { field: 'transactions' })

const Commit = z.object({
  accountId: z.string().nullish(),
  // The file hash of the import session this commit finishes. The session is deleted in the
  // commit's transaction, so it is gone exactly when the rows are in (#535).
  session: z
    .string({ error: asField('FIELD_INVALID') })
    .regex(FILE_HASH, { error: asField('FIELD_INVALID') })
    .optional(),
  defaultCurrency: text('FIELD_REQUIRED'),
  transactions: z.array(ImportRow, { error: emptyBatch }).min(1, { error: emptyBatch }),
  // A non-array here used to be silently replaced with `[]`, quietly dropping every split
  // the user had set up. It is the same malformation as a bad element, so it answers the
  // same way.
  groupSplits: z.array(GroupSplitInput, { error: malformedSplit }).optional(),
})

app.post('/commit', async (c) => {
  const userId = c.get('userId')
  const body = await parseBody(c, Commit)
  if (!body.ok) return body.response
  const committed = await commitImport(userId, {
    accountId: body.data.accountId,
    defaultCurrency: body.data.defaultCurrency,
    rows: body.data.transactions,
    splits: body.data.groupSplits ?? [],
    session: body.data.session,
  })
  if (!committed.ok) return failWith(c, committed.failure)
  return c.json(committed.value, 201)
})

// --- Sessions (#535) -------------------------------------------------------------------
//
// An import in progress, kept here rather than in the browser so it survives a closed tab,
// a refused commit and a change of device. The page owns the payload; this stores it.

// What a 5,000-row preview with its row decisions comes to, with room to spare. Past it the
// page still imports; it just can't save the attempt.
const MAX_SESSION_BYTES = 5 * 1024 * 1024

// GET /api/import/sessions
// The caller's saved imports, most recent first, without their payloads. Sessions untouched
// for 30 days are dropped first.
// 200: { sessions: [{ fileHash, fileName, version, rowCount, lastError, savedAt }] }
app.get('/sessions', async (c) => {
  return c.json({ sessions: await listSessions(c.get('userId')) })
})

// GET /api/import/sessions/:fileHash
// 200: { fileHash, fileName, version, rowCount, lastError, savedAt, payload }
// 404: IMPORT_SESSION_NOT_FOUND, also the answer after the commit that finished it landed
app.get('/sessions/:fileHash', async (c) => {
  const fileHash = c.req.param('fileHash')
  if (!FILE_HASH.test(fileHash)) return fail(c, 'IMPORT_SESSION_NOT_FOUND')
  const session = await readSession(c.get('userId'), fileHash)
  if (!session) return fail(c, 'IMPORT_SESSION_NOT_FOUND')
  return c.json(session)
})

const SaveSession = z.object({
  fileName: text('FIELD_REQUIRED'),
  version: z.int({ error: asField('FIELD_NOT_INTEGER') }),
  rowCount: z.int({ error: asField('FIELD_NOT_INTEGER') }).min(0, {
    error: asField('FIELD_NOT_INTEGER'),
  }),
  payload: z.record(z.string(), z.unknown(), { error: asField('FIELD_NOT_OBJECT') }),
  lastError: z.record(z.string(), z.unknown(), { error: asField('FIELD_NOT_OBJECT') }).nullish(),
})

// PUT /api/import/sessions/:fileHash
// Creates or replaces the caller's session for this file.
// Request: { fileName, version, rowCount, payload, lastError? }
// 200: { savedAt }
// 413: IMPORT_SESSION_TOO_LARGE, before the body is read
app.put(
  '/sessions/:fileHash',
  bodyLimit({
    maxSize: MAX_SESSION_BYTES,
    onError: (c) => fail(c, 'IMPORT_SESSION_TOO_LARGE'),
  }),
  async (c) => {
    const fileHash = c.req.param('fileHash')
    if (!FILE_HASH.test(fileHash)) return fail(c, 'FIELD_INVALID', { field: 'fileHash' })
    const body = await parseBody(c, SaveSession)
    if (!body.ok) return body.response
    const { lastError, ...rest } = body.data
    return c.json(await saveSession(c.get('userId'), fileHash, { ...rest, lastError }))
  },
)

// DELETE /api/import/sessions/:fileHash
// 204 whether or not there was one: discarding twice is still discarded.
app.delete('/sessions/:fileHash', async (c) => {
  const fileHash = c.req.param('fileHash')
  if (FILE_HASH.test(fileHash)) await deleteSession(c.get('userId'), fileHash)
  return c.body(null, 204)
})

export default app
