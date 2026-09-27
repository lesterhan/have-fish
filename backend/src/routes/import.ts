import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { commitImport } from '../import/commit-service'
import { findPossibleDuplicates } from '../import/duplicates-service'
import { IMPORT_KEY } from '../import/fingerprint'
import { previewImport } from '../import/preview-service'
import { fail, failWith } from '../respond'
import { amountLike, as, asField, parseBody, text } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

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
  })
  if (!committed.ok) return failWith(c, committed.failure)
  return c.json(committed.value, 201)
})

export default app
