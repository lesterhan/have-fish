import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { db } from '../db'
import { transactions, postings, csvParsers, importRules, accounts, groupSettlements, expenseGroups, groupCategories, user } from '../db/schema'
import { eq, isNull, and, gte, lte, or, inArray } from 'drizzle-orm'
import { parseCsv, normalizeHeader } from '../import/csv-parser'
import { buildParser } from '../import/dynamic-parser'
import type { ParsedTransaction, ColumnMapping } from '../import/types'
import { buildRegularPostings, buildFishPiePostings, buildFishPieCrossCurrencyPostings, buildFishPieSameCurrencyPostings, buildCrossCurrencySpendPostings } from '../import/postings'
import { createGroupExpenseInTx, fetchGroupWithMembers, resolvePayerImportContext } from '../fish-pie-expense-service'
import { ensureSharedAccount } from '../fish-pie-accounts'

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

  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400)
  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)

  const csv = await file.text()
  const rows = parseCsv(csv)

  if (rows.length === 0) return c.json({ error: 'CSV is empty or has no data rows' }, 422)

  const fingerprint = normalizeHeader(Object.keys(rows[0]))

  const userParsers = await db
    .select()
    .from(csvParsers)
    .where(and(eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))

  const matched = userParsers.find((p) => p.normalizedHeader === fingerprint)

  if (!matched) {
    return c.json(
      { error: 'No saved parser matched this CSV. Create one in Settings → Import Parsers.' },
      422,
    )
  }

  const parse = buildParser(matched.columnMapping as ColumnMapping)
  const result = parse(rows)

  // Apply active rules: for each regular (non-transfer) row, find the first rule
  // whose pattern is a case-insensitive substring of the description.
  const activeRules = await db
    .select({ pattern: importRules.pattern, accountId: importRules.accountId })
    .from(importRules)
    .where(and(eq(importRules.userId, userId), eq(importRules.status, 'active'), isNull(importRules.deletedAt)))

  const matchRule = (description: string) =>
    activeRules.find((r) => description.toLowerCase().includes(r.pattern.toLowerCase()))

  // The user's own name — used to tell a convert-and-park (where the counterparty is the
  // user themselves, e.g. a Wise CAD→EUR conversion) from a cross-currency spend (a card
  // purchase, where the counterparty is a merchant). Conversions are the rare case; spends
  // dominate, so cross-currency rows default to spend unless the name matches.
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
  const userName = (u?.name ?? '').trim().toLowerCase()

  const transactionsWithRules = result.transactions.map((t) => {
    if (t.isTransfer === false) {
      if (!t.description) return t
      const match = matchRule(t.description)
      return match ? { ...t, suggestedOffsetAccountId: match.accountId } : t
    }
    if (t.isTransfer === true) {
      // Cross-currency row: default to spend; flag as a convert-and-park only when the
      // payee/description is the user themselves. For spends, pre-fill the expense account
      // from the matching import rule so a recognized merchant needs no manual entry.
      const desc = (t.description ?? '').trim().toLowerCase()
      const isOwnTransfer = userName.length > 0 && desc.length > 0 && desc.includes(userName)
      if (isOwnTransfer) return { ...t, suggestedKind: 'transfer' as const }
      const match = t.description ? matchRule(t.description) : undefined
      return {
        ...t,
        suggestedKind: 'spend' as const,
        ...(match ? { suggestedExpenseAccountId: match.accountId } : {}),
      }
    }
    return t
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
// Request body: { rows: [{ accountId: string, date: string, amount: string }] }
// Response: { duplicates: (PossibleDuplicate | null)[] }
//   where PossibleDuplicate = { transactionId, date, amount, currency } | null
app.post('/check-duplicates', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { rows } = body

  if (!Array.isArray(rows) || rows.length === 0) {
    return c.json({ duplicates: [] })
  }

  type InputRow = { accountId: string; date: string; amount: string }
  type PossibleDuplicate = {
    transactionId: string
    date: string
    amount: string
    currency: string
    fishPieGroupId?: string
    fishPieGroupName?: string
  } | null

  const inputRows = rows as InputRow[]
  const result: PossibleDuplicate[] = inputRows.map(() => null)

  // Group row indices by accountId; skip empty strings (transfer rows not checked).
  const byAccount = new Map<string, number[]>()
  for (let i = 0; i < inputRows.length; i++) {
    const { accountId } = inputRows[i]
    if (!accountId) continue
    if (!byAccount.has(accountId)) byAccount.set(accountId, [])
    byAccount.get(accountId)!.push(i)
  }

  for (const [accountId, indices] of byAccount) {
    // Verify the account belongs to this user before querying postings.
    const owned = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
      .limit(1)
    if (owned.length === 0) continue

    const dates = indices.map((i) => new Date(inputRows[i].date))
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
    for (const i of indices) {
      const row = inputRows[i]
      const txDate = new Date(row.date).getTime()
      const txAmount = parseFloat(row.amount)

      const match = existing.find((e) => {
        const eDate = new Date(e.date).getTime()
        const eAmount = parseFloat(e.amount)
        return (
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

  // Enrich matched duplicates: check if any matched transaction is a Fish Pie settlement
  const matchedTxIds = result.filter((r) => r !== null).map((r) => r!.transactionId)
  if (matchedTxIds.length > 0) {
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

    const settlementByTxId = new Map<string, { groupId: string; groupName: string }>()
    for (const row of settlementRows) {
      if (row.payerTransactionId) settlementByTxId.set(row.payerTransactionId, { groupId: row.groupId, groupName: row.groupName })
      if (row.receiverTransactionId) settlementByTxId.set(row.receiverTransactionId, { groupId: row.groupId, groupName: row.groupName })
    }

    for (const entry of result) {
      if (!entry) continue
      const settlement = settlementByTxId.get(entry.transactionId)
      if (settlement) {
        entry.fishPieGroupId = settlement.groupId
        entry.fishPieGroupName = settlement.groupName
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
app.post('/commit', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { accountId, defaultCurrency, transactions: parsed, groupSplits } = body

  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)
  if (!Array.isArray(parsed) || parsed.length === 0) return c.json({ error: 'transactions must be a non-empty array' }, 400)

  // Validate groupSplits and verify membership up front (fail fast before any DB writes)
  type GroupSplit = { rowIndex: number; groupId: string; categoryId?: string | null }
  const splits: GroupSplit[] = Array.isArray(groupSplits) ? groupSplits : []
  const groupCache = new Map<string, Awaited<ReturnType<typeof fetchGroupWithMembers>>>()
  for (const split of splits) {
    if (typeof split.rowIndex !== 'number' || typeof split.groupId !== 'string') {
      return c.json({ error: 'groupSplits entries must have rowIndex and groupId' }, 400)
    }
    if (split.rowIndex < 0 || split.rowIndex >= parsed.length) {
      return c.json({ error: `groupSplits rowIndex ${split.rowIndex} out of range` }, 400)
    }
    if (!groupCache.has(split.groupId)) {
      const result = await fetchGroupWithMembers(split.groupId)
      if (!result) return c.json({ error: `group ${split.groupId} not found` }, 404)
      if (!result.members.some((m) => m.userId === userId)) {
        return c.json({ error: `not a member of group ${split.groupId}` }, 403)
      }
      groupCache.set(split.groupId, result)
    }
    // Category (optional) must belong to the split's group and be active — import is a
    // create flow, so archived categories are rejected.
    if (split.categoryId) {
      const [cat] = await db
        .select({ id: groupCategories.id, archivedAt: groupCategories.archivedAt })
        .from(groupCategories)
        .where(and(eq(groupCategories.id, split.categoryId), eq(groupCategories.groupId, split.groupId)))
      if (!cat) return c.json({ error: `category ${split.categoryId} not found in group ${split.groupId}` }, 400)
      if (cat.archivedAt) return c.json({ error: `category ${split.categoryId} is archived` }, 400)
    }
  }
  const splitByRowIndex = new Map(splits.map((s) => [s.rowIndex, s]))

  // Per-row validation — requirements differ by row type
  for (const [rowIdx, t] of (parsed as Record<string, unknown>[]).entries()) {
    if (t.isTransfer === 'cross-currency-spend') {
      if (!t.sourceAccountId) return c.json({ error: 'cross-currency-spend rows must include sourceAccountId' }, 400)
      if (!t.expenseAccountId) return c.json({ error: 'cross-currency-spend rows must include expenseAccountId' }, 400)
      if (!t.conversionAccountId) return c.json({ error: 'cross-currency-spend rows must include conversionAccountId' }, 400)
      if (t.feeAmount && !t.feeAccountId) return c.json({ error: 'cross-currency-spend rows with a fee must include feeAccountId' }, 400)
    } else if (t.isTransfer === true) {
      if (!t.sourceAccountId) return c.json({ error: 'transfer rows must include sourceAccountId' }, 400)
      // A Fish Pie split routes through buildFishPieCrossCurrencyPostings, which splits the
      // target leg into the group + payer-expense accounts and never uses targetAccountId —
      // so a shared cross-currency spend has no target asset to require.
      if (!t.targetAccountId && !splitByRowIndex.has(rowIdx)) return c.json({ error: 'transfer rows must include targetAccountId' }, 400)
      if (!t.conversionAccountId) return c.json({ error: 'transfer rows must include conversionAccountId' }, 400)
      if (!t.feeAccountId) return c.json({ error: 'transfer rows must include feeAccountId' }, 400)
    } else if (t.isTransfer === 'same-currency') {
      if (!t.targetAccountId) return c.json({ error: 'same-currency transfer rows must include targetAccountId' }, 400)
      if (!t.sourceAccountId) return c.json({ error: 'same-currency transfer rows must include sourceAccountId' }, 400)
      if (!t.feeAccountId) return c.json({ error: 'same-currency transfer rows must include feeAccountId' }, 400)
    } else {
      // Fish Pie rows don't need offsetAccountId — the backend derives it from ensureSharedAccount
      if (!t.offsetAccountId && !splitByRowIndex.has(rowIdx)) return c.json({ error: 'regular rows must include offsetAccountId' }, 400)
      if (!t.sourceAccountId && !accountId) return c.json({ error: 'regular rows require sourceAccountId or a global accountId' }, 400)
    }
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
    sourceAmount: string   // negative (leaving source)
    sourceCurrency: string
    targetAmount: string   // positive (arriving at target)
    targetCurrency: string
    feeAmount?: string     // positive
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
    sourceAmount: string   // negative, gross incl. fee (leaving source)
    sourceCurrency: string
    targetAmount: string   // positive (the spend, in targetCurrency)
    targetCurrency: string
    feeAmount?: string     // positive
    feeCurrency?: string
    sourceAccountId: string
    expenseAccountId: string   // the spend account
    conversionAccountId: string
    feeAccountId?: string
  }

  type SameCurrencyTransferRow = {
    isTransfer: 'same-currency'
    date: string
    description?: string
    amount: string    // net amount received (positive)
    feeAmount: string // fee charged (positive)
    currency: string
    targetAccountId: string   // the account that received the money
    sourceAccountId: string   // where the money came from
    feeAccountId: string
  }

  let fishPieExpenses = 0

  await db.transaction(async (tx) => {
    for (const [rowIndex, t] of (parsed as (RegularRow | TransferRow | SameCurrencyTransferRow | CrossCurrencySpendRow)[]).entries()) {
      const [newTx] = await tx
        .insert(transactions)
        .values({ userId, date: new Date(t.date), description: t.description })
        .returning()

      if (t.isTransfer === 'cross-currency-spend') {
        // Cross-currency spend — a purchase in a currency the user doesn't hold, funded
        // from another-currency account via on-the-fly conversion. equity:conversions
        // bridges both sides; the spend lands in an expense account (never the bridge),
        // and no phantom asset balance is created. See buildCrossCurrencySpendPostings.
        const srcAmount = parseFloat(t.sourceAmount)  // negative
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

        const srcAmount = parseFloat(t.sourceAmount)  // negative
        const feeVal = t.feeAmount ? parseFloat(t.feeAmount) : 0  // positive or 0
        const tgtAmount = parseFloat(t.targetAmount)  // positive
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
          type PostingRow = { transactionId: string; accountId: string; amount: string; currency: string }
          const postingRows: PostingRow[] = [
            { transactionId: newTx.id, accountId: t.sourceAccountId,     amount: t.sourceAmount,         currency: t.sourceCurrency },
            { transactionId: newTx.id, accountId: t.conversionAccountId, amount: conversionSrcAmount,     currency: t.sourceCurrency },
            { transactionId: newTx.id, accountId: t.conversionAccountId, amount: (-tgtAmount).toFixed(2), currency: t.targetCurrency },
            { transactionId: newTx.id, accountId: t.targetAccountId,     amount: t.targetAmount,          currency: t.targetCurrency },
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
            { transactionId: newTx.id, accountId: t.targetAccountId, amount: t.amount,   currency: t.currency },
            { transactionId: newTx.id, accountId: t.feeAccountId,    amount: t.feeAmount, currency: t.currency },
            { transactionId: newTx.id, accountId: t.sourceAccountId, amount: `-${gross}`, currency: t.currency },
          ])
        }
      } else {
        const currency = t.currency ?? defaultCurrency
        const sourceId = t.sourceAccountId ?? accountId
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
