import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { accountsOwnedBy } from '../accounts/ownership-service'
import type { AppVariables } from '../app'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import {
  accounts,
  csvParsers,
  expenseGroups,
  groupCategories,
  groupExpenses,
  groupSettlements,
  importRules,
  postings,
  transactions,
  user,
} from '../db/schema'
import { fail } from '../errors'
import { ensureSharedAccount } from '../fish-pie-accounts'
import {
  createGroupExpenseInTx,
  fetchGroupWithMembers,
  resolvePayerImportContext,
} from '../fish-pie-expense-service'
import {
  detectDelimiter,
  normalizeHeader,
  parseCsv,
  SUPPORTED_DELIMITERS,
} from '../import/csv-parser'
import { buildParser } from '../import/dynamic-parser'
import { merchantKey } from '../import/merchant'
import {
  buildCrossCurrencySpendPostings,
  buildFishPieCrossCurrencyPostings,
  buildFishPiePostings,
  buildFishPieSameCurrencyPostings,
  buildRegularPostings,
} from '../import/postings'
import type { ColumnMapping } from '../import/types'
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

  const csv = await file.text()

  const userParsers = await db
    .select()
    .from(csvParsers)
    .where(and(eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))

  // Parse with the detected delimiter first; if no parser matches, retry the
  // remaining supported delimiters before giving up. This makes a parser that
  // was built with a manually-overridden delimiter still match, even when the
  // auto-detector would have guessed a different one for the same file.
  const detected = detectDelimiter(csv)
  const candidates = [detected, ...SUPPORTED_DELIMITERS.filter((d) => d !== detected)]

  let rows: Record<string, string>[] = []
  let matched: (typeof userParsers)[number] | undefined
  for (const delimiter of candidates) {
    rows = parseCsv(csv, delimiter)
    const header = rows[0]
    if (!header) continue
    const fingerprint = normalizeHeader(Object.keys(header))
    matched = userParsers.find((p) => p.normalizedHeader === fingerprint)
    if (matched) break
  }

  if (rows.length === 0) return fail(c, 'CSV_EMPTY')

  if (!matched) {
    return fail(c, 'NO_PARSER_MATCHED')
  }

  const parse = buildParser(matched.columnMapping as ColumnMapping)
  const result = parse(rows)

  // Apply active rules: for each regular (non-transfer) row, find the first rule
  // whose pattern is a case-insensitive substring of the description. The matching
  // pattern is returned alongside the suggestion so the UI can name the rule that
  // fired rather than showing an unattributable pre-filled account.
  //
  // A rule carries one of two targets. An account rule suggests an offset/expense
  // account; a split rule suggests a Fish Pie group and optional category, which the
  // row renders pre-split. First match wins either way, so the two kinds compete on
  // equal footing rather than one being preferred.
  const activeRules = await db
    .select({
      pattern: importRules.pattern,
      accountId: importRules.accountId,
      groupId: importRules.groupId,
      categoryId: importRules.categoryId,
    })
    .from(importRules)
    .where(
      and(
        eq(importRules.userId, userId),
        eq(importRules.status, 'active'),
        isNull(importRules.deletedAt),
      ),
    )

  const matchRule = (description: string) =>
    activeRules.find((r) => description.toLowerCase().includes(r.pattern.toLowerCase()))

  // Turns a matched rule into the suggestion fields for a row. `accountField` differs by
  // row kind — a regular row pre-fills its offset account, a cross-currency spend its
  // expense account — but a split rule suggests the same group/category either way,
  // since both commit through the Fish Pie posting builders.
  type MatchedRule = NonNullable<ReturnType<typeof matchRule>>
  const suggestionFor = (
    match: MatchedRule,
    accountField: 'suggestedOffsetAccountId' | 'suggestedExpenseAccountId',
  ) => ({
    ...(match.accountId
      ? { [accountField]: match.accountId }
      : { suggestedGroupId: match.groupId, suggestedCategoryId: match.categoryId }),
    matchedRulePattern: match.pattern,
  })

  // The user's own name — used to tell a convert-and-park (where the counterparty is the
  // user themselves, e.g. a Wise CAD→EUR conversion) from a cross-currency spend (a card
  // purchase, where the counterparty is a merchant). Conversions are the rare case; spends
  // dominate, so cross-currency rows default to spend unless the name matches.
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
  const userName = (u?.name ?? '').trim().toLowerCase()

  const transactionsWithRules = result.transactions.map((t) => {
    // Merchant stem — the key the preview UI clusters repeat merchants by. Stamped on
    // every row carrying a description, whatever its kind and whether or not a rule
    // matched, so grouping does not depend on rules existing yet. Omitted when the
    // description normalizes to nothing, since an empty key would group unrelated rows.
    const stem = t.description ? merchantKey(t.description) : ''
    const base = stem ? { ...t, merchantKey: stem } : t

    if (t.isTransfer === false) {
      if (!t.description) return base
      const match = matchRule(t.description)
      return match ? { ...base, ...suggestionFor(match, 'suggestedOffsetAccountId') } : base
    }
    if (t.isTransfer === true) {
      // Cross-currency row: default to spend; flag as a convert-and-park only when the
      // payee/description is the user themselves. For spends, pre-fill the target from the
      // matching import rule so a recognized merchant needs no manual entry.
      const desc = (t.description ?? '').trim().toLowerCase()
      const isOwnTransfer = userName.length > 0 && desc.length > 0 && desc.includes(userName)
      if (isOwnTransfer) return { ...base, suggestedKind: 'transfer' as const }
      const match = t.description ? matchRule(t.description) : undefined
      return {
        ...base,
        suggestedKind: 'spend' as const,
        ...(match ? suggestionFor(match, 'suggestedExpenseAccountId') : {}),
      }
    }
    return base
  })

  return c.json({
    parser: matched.name,
    defaultAccountId: matched.defaultAccountId,
    isMultiCurrency: matched.isMultiCurrency,
    defaultFeeAccountId: matched.defaultFeeAccountId,
    ...result,
    transactions: transactionsWithRules,
  })
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
// within 0.01: 8,400 JPY and 8,400 CAD are not the same purchase.

// A row the caller has already resolved to an account. An empty `accountId` is how the
// frontend marks a transfer row, which this endpoint does not check — hence the empty
// string alongside the uuid rather than a bare `z.uuid()`.
const DuplicateCheckRow = z.object({
  accountId: z.union([z.literal(''), z.uuid()], { error: asField('FIELD_NOT_UUID') }),
  date: z.string({ error: asField('FIELD_NOT_DATE') }),
  amount: amountLike,
  currency: z.string(),
})

const CheckDuplicates = z.object({ rows: z.array(DuplicateCheckRow) })

app.post('/check-duplicates', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, CheckDuplicates)
  if (!parsed.ok) return parsed.response
  const { rows } = parsed.data

  if (rows.length === 0) return c.json({ duplicates: [] })

  type InputRow = z.output<typeof DuplicateCheckRow>
  type PossibleDuplicate = {
    transactionId: string
    date: string
    amount: string
    currency: string
    fishPieKind?: 'expense' | 'settlement'
    fishPieGroupId?: string
    fishPieGroupName?: string
  } | null

  const inputRows: InputRow[] = rows
  const result: PossibleDuplicate[] = inputRows.map(() => null)

  // Group rows by accountId; skip empty strings (transfer rows not checked). The row
  // travels with its index because the answer is positional — `result[i]` lines up with
  // the caller's `rows[i]` — but every read downstream wants the row, not the number.
  const byAccount = new Map<string, { i: number; row: InputRow }[]>()
  for (const [i, row] of inputRows.entries()) {
    const { accountId } = row
    if (!accountId) continue
    const forAccount = byAccount.get(accountId) ?? []
    forAccount.push({ i, row })
    byAccount.set(accountId, forAccount)
  }

  for (const [accountId, entries] of byAccount) {
    // Verify the account belongs to this user before querying postings.
    const owned = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)),
      )
      .limit(1)
    if (owned.length === 0) continue

    const dates = entries.map((e) => new Date(e.row.date))
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())))
    minDate.setDate(minDate.getDate() - 1)
    maxDate.setDate(maxDate.getDate() + 1)
    maxDate.setHours(23, 59, 59, 999)

    const existing = await db
      .select({
        transactionId: postings.transactionId,
        date: transactions.date,
        amount: postings.amount,
        currency: postings.currency,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(
          eq(postings.accountId, accountId),
          isNull(postings.deletedAt),
          isNull(transactions.deletedAt),
          gte(transactions.date, minDate),
          lte(transactions.date, maxDate),
        ),
      )

    const dayMs = 24 * 60 * 60 * 1000
    for (const { i, row } of entries) {
      const txDate = new Date(row.date).getTime()
      const txAmount = parseFloat(row.amount)
      const txCurrency = row.currency.toUpperCase()

      const match = existing.find((e) => {
        const eDate = new Date(e.date).getTime()
        const eAmount = parseFloat(e.amount)
        return (
          e.currency.toUpperCase() === txCurrency &&
          Math.abs(eDate - txDate) <= dayMs &&
          Math.abs(Math.abs(eAmount) - Math.abs(txAmount)) <= 0.01
        )
      })

      if (match) {
        result[i] = {
          transactionId: match.transactionId,
          date: match.date.toISOString().substring(0, 10),
          amount: match.amount,
          currency: match.currency,
        }
      }
    }
  }

  // Enrich matched duplicates entered through Fish Pie, so the review can say "that's the
  // lunch you split" rather than show a bare possible duplicate. A split expense reaches
  // its transactions through `transactions.groupExpenseId` (member and payer transactions,
  // and import transactions since the forward link) or, for older imports, through
  // `groupExpenses.transactionId`; a settlement through its payer or receiver transaction.
  const matchedTxIds = result.filter((r) => r !== null).map((r) => r.transactionId)
  if (matchedTxIds.length > 0) {
    type FishPieContext = {
      kind: 'expense' | 'settlement'
      groupId: string
      groupName: string
    }
    const contextByTxId = new Map<string, FishPieContext>()

    const expenseRows = await db
      .select({
        transactionId: transactions.id,
        groupExpenseId: transactions.groupExpenseId,
        groupId: expenseGroups.id,
        groupName: expenseGroups.name,
      })
      .from(transactions)
      .innerJoin(groupExpenses, eq(groupExpenses.id, transactions.groupExpenseId))
      .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
      .where(and(inArray(transactions.id, matchedTxIds), isNull(groupExpenses.deletedAt)))
    for (const row of expenseRows) {
      contextByTxId.set(row.transactionId, {
        kind: 'expense',
        groupId: row.groupId,
        groupName: row.groupName,
      })
    }

    const legacyImportRows = await db
      .select({
        transactionId: groupExpenses.transactionId,
        groupId: expenseGroups.id,
        groupName: expenseGroups.name,
      })
      .from(groupExpenses)
      .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
      .where(
        and(inArray(groupExpenses.transactionId, matchedTxIds), isNull(groupExpenses.deletedAt)),
      )
    for (const row of legacyImportRows) {
      if (!row.transactionId) continue
      contextByTxId.set(row.transactionId, {
        kind: 'expense',
        groupId: row.groupId,
        groupName: row.groupName,
      })
    }

    const settlementRows = await db
      .select({
        payerTransactionId: groupSettlements.payerTransactionId,
        receiverTransactionId: groupSettlements.receiverTransactionId,
        groupId: expenseGroups.id,
        groupName: expenseGroups.name,
      })
      .from(groupSettlements)
      .innerJoin(expenseGroups, eq(groupSettlements.groupId, expenseGroups.id))
      .where(
        and(
          isNull(groupSettlements.deletedAt),
          or(
            inArray(groupSettlements.payerTransactionId, matchedTxIds),
            inArray(groupSettlements.receiverTransactionId, matchedTxIds),
          ),
        ),
      )
    for (const row of settlementRows) {
      const context: FishPieContext = {
        kind: 'settlement',
        groupId: row.groupId,
        groupName: row.groupName,
      }
      if (row.payerTransactionId) contextByTxId.set(row.payerTransactionId, context)
      if (row.receiverTransactionId) contextByTxId.set(row.receiverTransactionId, context)
    }

    for (const entry of result) {
      if (!entry) continue
      const context = contextByTxId.get(entry.transactionId)
      if (context) {
        entry.fishPieKind = context.kind
        entry.fishPieGroupId = context.groupId
        entry.fishPieGroupName = context.groupName
      }
    }
  }

  return c.json({ duplicates: result })
})

// POST /api/import/commit
// Writes a set of pre-parsed transactions to the database.
//
// Regular rows produce 2 postings (source + offset). Transfer rows produce
// 4 postings (no fee) or 5 postings (with fee) using the equity:conversion
// account to bridge the two currencies — see inline comments.
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
// Response: { created: number }
// One imported row, with every field it can carry typed.
//
// Which fields a row *must* carry depends on its kind and on what else the request said —
// a Fish Pie split supplies the accounts a plain row would have to name — so the loop
// below is still what decides that, and answers `IMPORT_ROW_MISSING_ACCOUNT` with the row
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
  const { accountId, defaultCurrency, transactions: parsed } = body.data

  // Verify group membership up front (fail fast before any DB writes)
  const splits = body.data.groupSplits ?? []
  const groupCache = new Map<string, Awaited<ReturnType<typeof fetchGroupWithMembers>>>()
  for (const split of splits) {
    if (split.rowIndex < 0 || split.rowIndex >= parsed.length) {
      return fail(c, 'GROUP_SPLIT_ROW_OUT_OF_RANGE', { rowIndex: split.rowIndex })
    }
    if (!groupCache.has(split.groupId)) {
      const result = await fetchGroupWithMembers(split.groupId)
      if (!result) return fail(c, 'GROUP_NOT_FOUND', { groupId: split.groupId })
      if (!result.members.some((m) => m.userId === userId)) {
        return fail(c, 'NOT_A_GROUP_MEMBER', { groupId: split.groupId })
      }
      groupCache.set(split.groupId, result)
    }
    // Category (optional) must belong to the split's group and be active — import is a
    // create flow, so archived categories are rejected.
    if (split.categoryId) {
      const [cat] = await db
        .select({ id: groupCategories.id, archivedAt: groupCategories.archivedAt })
        .from(groupCategories)
        .where(
          and(eq(groupCategories.id, split.categoryId), eq(groupCategories.groupId, split.groupId)),
        )
      if (!cat)
        return fail(c, 'CATEGORY_NOT_IN_GROUP', {
          categoryId: split.categoryId,
          groupId: split.groupId,
        })
      if (cat.archivedAt) return fail(c, 'CATEGORY_ARCHIVED', { categoryId: split.categoryId })
    }
  }
  const splitByRowIndex = new Map(splits.map((s) => [s.rowIndex, s]))

  // Per-row validation — requirements differ by row type
  for (const [rowIdx, t] of parsed.entries()) {
    if (t.isTransfer === 'cross-currency-spend') {
      if (!t.sourceAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'cross-currency-spend',
          field: 'sourceAccountId',
        })
      if (!t.expenseAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'cross-currency-spend',
          field: 'expenseAccountId',
        })
      if (!t.conversionAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'cross-currency-spend',
          field: 'conversionAccountId',
        })
      if (t.feeAmount && !t.feeAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'cross-currency-spend',
          field: 'feeAccountId',
        })
    } else if (t.isTransfer === true) {
      if (!t.sourceAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'transfer',
          field: 'sourceAccountId',
        })
      // A Fish Pie split routes through buildFishPieCrossCurrencyPostings, which splits the
      // target leg into the group + payer-expense accounts and never uses targetAccountId —
      // so a shared cross-currency spend has no target asset to require.
      if (!t.targetAccountId && !splitByRowIndex.has(rowIdx))
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'transfer',
          field: 'targetAccountId',
        })
      if (!t.conversionAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'transfer',
          field: 'conversionAccountId',
        })
      if (!t.feeAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', { rowKind: 'transfer', field: 'feeAccountId' })
    } else if (t.isTransfer === 'same-currency') {
      if (!t.targetAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'same-currency-transfer',
          field: 'targetAccountId',
        })
      if (!t.sourceAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'same-currency-transfer',
          field: 'sourceAccountId',
        })
      if (!t.feeAccountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'same-currency-transfer',
          field: 'feeAccountId',
        })
    } else {
      // Fish Pie rows don't need offsetAccountId — the backend derives it from ensureSharedAccount
      if (!t.offsetAccountId && !splitByRowIndex.has(rowIdx))
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'regular',
          field: 'offsetAccountId',
        })
      if (!t.sourceAccountId && !accountId)
        return fail(c, 'IMPORT_ROW_MISSING_ACCOUNT', {
          rowKind: 'regular',
          field: 'sourceAccountId',
        })
    }
  }

  // Every account the request names must be one of the caller's own, the same check
  // `POST /api/transactions` makes. It covers ids a row carries but a Fish Pie split then
  // ignores, because an id that is not yours has no business in the request at all.
  const namedAccountIds = [
    accountId,
    ...parsed.flatMap((t) => [
      t.offsetAccountId,
      t.sourceAccountId,
      t.targetAccountId,
      t.conversionAccountId,
      t.expenseAccountId,
      t.feeAccountId,
    ]),
  ].filter((id): id is string => !!id)
  if (!(await accountsOwnedBy(userId, namedAccountIds))) {
    return fail(c, 'ACCOUNTS_NOT_FOUND')
  }

  type RegularRow = {
    isTransfer: false
    date: string
    amount: string
    description?: string
    currency?: string
    offsetAccountId: string
    sourceAccountId?: string
  }

  type TransferRow = {
    isTransfer: true
    date: string
    description?: string
    sourceAmount: string // negative (leaving source)
    sourceCurrency: string
    targetAmount: string // positive (arriving at target)
    targetCurrency: string
    feeAmount?: string // positive
    feeCurrency?: string
    sourceAccountId: string
    targetAccountId: string
    conversionAccountId: string
    feeAccountId: string
  }

  type CrossCurrencySpendRow = {
    isTransfer: 'cross-currency-spend'
    date: string
    description?: string
    sourceAmount: string // negative, gross incl. fee (leaving source)
    sourceCurrency: string
    targetAmount: string // positive (the spend, in targetCurrency)
    targetCurrency: string
    feeAmount?: string // positive
    feeCurrency?: string
    sourceAccountId: string
    expenseAccountId: string // the spend account
    conversionAccountId: string
    feeAccountId?: string
  }

  type SameCurrencyTransferRow = {
    isTransfer: 'same-currency'
    date: string
    description?: string
    amount: string // net amount received (positive)
    feeAmount: string // fee charged (positive)
    currency: string
    targetAccountId: string // the account that received the money
    sourceAccountId: string // where the money came from
    feeAccountId: string
  }

  let fishPieExpenses = 0

  await db.transaction(async (tx) => {
    for (const [rowIndex, t] of (
      parsed as (RegularRow | TransferRow | SameCurrencyTransferRow | CrossCurrencySpendRow)[]
    ).entries()) {
      const newTx = returnedRow(
        await tx
          .insert(transactions)
          // `?? null` rather than letting `undefined` through: the column is nullable with
          // no default, so an omitted key and an explicit null store the same thing, and
          // `exactOptionalPropertyTypes` wants the difference spelled out.
          .values({ userId, date: new Date(t.date), description: t.description ?? null })
          .returning(),
        'insert transactions',
      )

      if (t.isTransfer === 'cross-currency-spend') {
        // Cross-currency spend — a purchase in a currency the user doesn't hold, funded
        // from another-currency account via on-the-fly conversion. equity:conversions
        // bridges both sides; the spend lands in an expense account (never the bridge),
        // and no phantom asset balance is created. See buildCrossCurrencySpendPostings.
        const srcAmount = parseFloat(t.sourceAmount) // negative
        const feeVal = t.feeAmount ? parseFloat(t.feeAmount) : 0
        const conversionSrcAmount = (-(srcAmount + feeVal)).toFixed(2)

        await tx.insert(postings).values(
          buildCrossCurrencySpendPostings({
            transactionId: newTx.id,
            sourceAccountId: t.sourceAccountId,
            sourceAmount: t.sourceAmount,
            sourceCurrency: t.sourceCurrency,
            conversionAccountId: t.conversionAccountId,
            conversionSrcAmount,
            targetAmount: t.targetAmount,
            targetCurrency: t.targetCurrency,
            expenseAccountId: t.expenseAccountId,
            feeAmount: t.feeAmount,
            feeCurrency: t.feeCurrency ?? t.sourceCurrency,
            feeAccountId: t.feeAccountId,
          }),
        )
      } else if (t.isTransfer === true) {
        // Cross-currency transfer — 4 or 5 postings (regular) or 5 or 6 (Fish Pie).
        //
        // Fish Pie variant: net target amount split between group clearing + payer expense.
        // Fee posting is untouched. targetAccountId is ignored (group/expense accounts replace it).
        //
        // Regular: equity:conversion bridges the two currencies:
        //   1. source account loses sourceAmount in sourceCurrency  (e.g. −200.00 CAD)
        //   2. equity:conversion gains the amount minus fee         (e.g. +199.04 CAD)
        //   3. fee expense account gains feeAmount                  (e.g.   +0.96 CAD)  ← omitted if no fee
        //   4. equity:conversion loses targetAmount in targetCurrency (e.g. −107.90 GBP)
        //   5. target account gains targetAmount in targetCurrency  (e.g. +107.90 GBP)
        //
        // Per-currency totals balance to zero.

        const srcAmount = parseFloat(t.sourceAmount) // negative
        const feeVal = t.feeAmount ? parseFloat(t.feeAmount) : 0 // positive or 0
        const tgtAmount = parseFloat(t.targetAmount) // positive
        const feeCurrency = t.feeCurrency ?? t.sourceCurrency
        const conversionSrcAmount = (-(srcAmount + feeVal)).toFixed(2)

        const groupSplit = splitByRowIndex.get(rowIndex)
        if (groupSplit) {
          const { group, members } = groupCache.get(groupSplit.groupId)!
          const groupAccountId = await ensureSharedAccount(userId, group, tx)
          const { payerExpenseAccountId, payerShareRatio } = await resolvePayerImportContext(tx, {
            categoryId: groupSplit.categoryId,
            members,
            payerId: userId,
          })

          await tx.insert(postings).values(
            buildFishPieCrossCurrencyPostings({
              transactionId: newTx.id,
              sourceAccountId: t.sourceAccountId,
              sourceAmount: t.sourceAmount,
              sourceCurrency: t.sourceCurrency,
              conversionAccountId: t.conversionAccountId,
              conversionSrcAmount,
              targetAmount: t.targetAmount,
              targetCurrency: t.targetCurrency,
              feeAmount: t.feeAmount,
              feeCurrency,
              feeAccountId: t.feeAccountId,
              groupAccountId,
              expenseAccountId: payerExpenseAccountId,
              payerShareRatio,
            }),
          )

          const absAmount = Math.abs(tgtAmount).toFixed(2)
          const dateStr = new Date(t.date).toISOString().slice(0, 10)
          await createGroupExpenseInTx(tx, {
            group,
            members,
            payerId: userId,
            description: t.description ?? '',
            amount: absAmount,
            currency: t.targetCurrency,
            date: dateStr,
            linkedTransactionId: newTx.id,
            skipPayerMemberTx: true,
            categoryId: groupSplit.categoryId ?? null,
          })
          fishPieExpenses++
        } else {
          type PostingRow = {
            transactionId: string
            accountId: string
            amount: string
            currency: string
          }
          const postingRows: PostingRow[] = [
            {
              transactionId: newTx.id,
              accountId: t.sourceAccountId,
              amount: t.sourceAmount,
              currency: t.sourceCurrency,
            },
            {
              transactionId: newTx.id,
              accountId: t.conversionAccountId,
              amount: conversionSrcAmount,
              currency: t.sourceCurrency,
            },
            {
              transactionId: newTx.id,
              accountId: t.conversionAccountId,
              amount: (-tgtAmount).toFixed(2),
              currency: t.targetCurrency,
            },
            {
              transactionId: newTx.id,
              accountId: t.targetAccountId,
              amount: t.targetAmount,
              currency: t.targetCurrency,
            },
          ]

          if (t.feeAmount && feeVal !== 0) {
            postingRows.splice(2, 0, {
              transactionId: newTx.id,
              accountId: t.feeAccountId,
              amount: t.feeAmount,
              currency: feeCurrency,
            })
          }

          await tx.insert(postings).values(postingRows)
        }
      } else if (t.isTransfer === 'same-currency') {
        // Same-currency IN transfer — 3 postings (regular) or 4 (Fish Pie).
        //
        // Fish Pie variant: net amount split between group clearing + payer expense.
        // Fee and source postings are untouched. targetAccountId is ignored.
        //
        // Regular:
        //   1. target account receives net amount (positive)
        //   2. fee expense account records the fee (positive)
        //   3. source account loses the gross amount (negative)
        const groupSplit = splitByRowIndex.get(rowIndex)
        if (groupSplit) {
          const { group, members } = groupCache.get(groupSplit.groupId)!
          const groupAccountId = await ensureSharedAccount(userId, group, tx)
          const { payerExpenseAccountId, payerShareRatio } = await resolvePayerImportContext(tx, {
            categoryId: groupSplit.categoryId,
            members,
            payerId: userId,
          })

          await tx.insert(postings).values(
            buildFishPieSameCurrencyPostings({
              transactionId: newTx.id,
              sourceAccountId: t.sourceAccountId,
              amount: t.amount,
              feeAmount: t.feeAmount,
              currency: t.currency,
              feeAccountId: t.feeAccountId,
              groupAccountId,
              expenseAccountId: payerExpenseAccountId,
              payerShareRatio,
            }),
          )

          const absAmount = Math.abs(parseFloat(t.amount)).toFixed(2)
          const dateStr = new Date(t.date).toISOString().slice(0, 10)
          await createGroupExpenseInTx(tx, {
            group,
            members,
            payerId: userId,
            description: t.description ?? '',
            amount: absAmount,
            currency: t.currency,
            date: dateStr,
            linkedTransactionId: newTx.id,
            skipPayerMemberTx: true,
            categoryId: groupSplit.categoryId ?? null,
          })
          fishPieExpenses++
        } else {
          const gross = (parseFloat(t.amount) + parseFloat(t.feeAmount)).toFixed(2)
          await tx.insert(postings).values([
            {
              transactionId: newTx.id,
              accountId: t.targetAccountId,
              amount: t.amount,
              currency: t.currency,
            },
            {
              transactionId: newTx.id,
              accountId: t.feeAccountId,
              amount: t.feeAmount,
              currency: t.currency,
            },
            {
              transactionId: newTx.id,
              accountId: t.sourceAccountId,
              amount: `-${gross}`,
              currency: t.currency,
            },
          ])
        }
      } else {
        const currency = t.currency ?? defaultCurrency
        const sourceId = t.sourceAccountId ?? accountId
        // The per-row pass above answered `IMPORT_ROW_MISSING_ACCOUNT` for exactly this,
        // so reaching it here means the two passes have drifted apart.
        if (!sourceId) throw new Error(`import row ${rowIndex} has no source account`)
        const groupSplit = splitByRowIndex.get(rowIndex)

        if (groupSplit) {
          // Fish Pie path — 3-posting import tx (BUG-004b fix).
          // The payer's share is recorded directly as a posting to their expense account,
          // so createGroupExpenseInTx skips the payer member tx (skipPayerMemberTx).
          // offsetAccountId on the row is intentionally ignored; groupAccountId is derived here.
          const { group, members } = groupCache.get(groupSplit.groupId)!
          const groupAccountId = await ensureSharedAccount(userId, group, tx)
          const { payerExpenseAccountId, payerShareRatio } = await resolvePayerImportContext(tx, {
            categoryId: groupSplit.categoryId,
            members,
            payerId: userId,
          })

          await tx.insert(postings).values(
            buildFishPiePostings({
              transactionId: newTx.id,
              sourceAccountId: sourceId,
              amount: t.amount,
              groupAccountId,
              expenseAccountId: payerExpenseAccountId,
              payerShareRatio,
              currency,
            }),
          )

          const absAmount = Math.abs(parseFloat(t.amount)).toFixed(2)
          const dateStr = new Date(t.date).toISOString().slice(0, 10)
          await createGroupExpenseInTx(tx, {
            group,
            members,
            payerId: userId,
            description: t.description ?? '',
            amount: absAmount,
            currency,
            date: dateStr,
            linkedTransactionId: newTx.id,
            skipPayerMemberTx: true,
            categoryId: groupSplit.categoryId ?? null,
          })
          fishPieExpenses++
        } else {
          await tx.insert(postings).values(
            buildRegularPostings({
              transactionId: newTx.id,
              sourceAccountId: sourceId,
              amount: t.amount,
              offsetAccountId: t.offsetAccountId,
              currency,
            }),
          )
        }
      }
    }
  })

  return c.json({ created: parsed.length, fishPieExpenses }, 201)
})

export default app
