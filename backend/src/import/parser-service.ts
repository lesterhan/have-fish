// Saved CSV parsers: a header fingerprint, the column mapping built for it, and the accounts
// the import form starts from. The preview matches a file to one (`preview-service`); this
// file is how they are listed, made, changed and retired.

import { and, eq, isNull } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { csvParsers } from '../db/schema'
import { errorBody, type Outcome } from '../errors'

type ParserRow = typeof csvParsers.$inferSelect

/** The columns a caller may set on a parser. */
export type ParserFields = Partial<
  Pick<
    ParserRow,
    | 'name'
    | 'normalizedHeader'
    | 'columnMapping'
    | 'defaultAccountId'
    | 'isMultiCurrency'
    | 'defaultFeeAccountId'
  >
>

const live = (userId: string, parserId: string) =>
  and(eq(csvParsers.id, parserId), eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt))

// A parser's default accounts are filled into the import form, and from there into the
// postings a commit writes, so they are held to the same rule: the caller's own, active.
// Answers with the first field that fails.
async function checkDefaults(userId: string, fields: ParserFields): Promise<Outcome<void>> {
  for (const field of ['defaultAccountId', 'defaultFeeAccountId'] as const) {
    const id = fields[field]
    if (id && !(await accountsOwnedBy(userId, [id]))) {
      return { ok: false, failure: errorBody('SETTING_ACCOUNT_NOT_FOUND', { field }) }
    }
  }
  return { ok: true, value: undefined }
}

/** Every live parser the caller has. */
export async function listParsers(userId: string): Promise<ParserRow[]> {
  return db
    .select()
    .from(csvParsers)
    .where(and(eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))
}

/** Save a parser, after checking its default accounts are the caller's. */
export async function createParser(
  userId: string,
  fields: Required<Pick<ParserFields, 'name' | 'normalizedHeader' | 'columnMapping'>> &
    ParserFields,
): Promise<Outcome<ParserRow>> {
  const checked = await checkDefaults(userId, fields)
  if (!checked.ok) return checked
  const created = await db
    .insert(csvParsers)
    .values({ ...fields, userId })
    .returning()
  return { ok: true, value: returnedRow(created, 'insert csv_parsers') }
}

/** Change a live parser of the caller's, after the same check on any default it names. */
export async function updateParser(
  userId: string,
  parserId: string,
  fields: ParserFields,
): Promise<Outcome<ParserRow>> {
  const checked = await checkDefaults(userId, fields)
  if (!checked.ok) return checked
  const [updated] = await db
    .update(csvParsers)
    .set(fields)
    .where(live(userId, parserId))
    .returning()
  if (!updated) return { ok: false, failure: errorBody('PARSER_NOT_FOUND') }
  return { ok: true, value: updated }
}

/** Soft-delete a parser. Deleting one that is gone, or someone else's, changes nothing. */
export async function deleteParser(userId: string, parserId: string): Promise<void> {
  await db.update(csvParsers).set({ deletedAt: new Date() }).where(live(userId, parserId))
}
