import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { csvParsers, importRules, user } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import { buildParser } from './dynamic-parser'
import { rowKeys } from './fingerprint'
import { matchParser, suggest } from './preview'
import type { ColumnMapping } from './types'

/**
 * Parse an uploaded CSV with the caller's saved parser that matches it, and suggest
 * accounts for each row. Writes nothing.
 *
 * Loads the caller's active parsers, rules and name; `preview.ts` does the matching and
 * the suggesting. Each row also gets its row key (`fingerprint.ts`), which the review sends
 * back with the rows it checks for duplicates and commits.
 */
export async function previewImport(userId: string, csv: string) {
  const userParsers = await db
    .select()
    .from(csvParsers)
    .where(and(eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))

  const { rows, parser } = matchParser(csv, userParsers)
  if (rows.length === 0) return refuse('CSV_EMPTY')
  if (!parser) return refuse('NO_PARSER_MATCHED')

  const result = buildParser(parser.columnMapping as ColumnMapping)(rows)

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

  const keys = rowKeys(parser.id, result.transactions)
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
  const userName = (u?.name ?? '').trim().toLowerCase()

  const preview = {
    parser: parser.name,
    defaultAccountId: parser.defaultAccountId,
    isMultiCurrency: parser.isMultiCurrency,
    defaultFeeAccountId: parser.defaultFeeAccountId,
    ...result,
    transactions: suggest(result.transactions, activeRules, userName).map((t, i) => ({
      ...t,
      importKey: keys[i],
    })),
  }
  return { ok: true, value: preview } satisfies Outcome<typeof preview>
}

function refuse(code: 'CSV_EMPTY' | 'NO_PARSER_MATCHED') {
  return { ok: false, failure: errorBody(code) } satisfies Outcome<never>
}
