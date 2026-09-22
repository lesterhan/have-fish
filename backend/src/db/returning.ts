/**
 * Reading the one row a statement was written to produce.
 *
 * Drizzle types every query as an array, so `const [row] = await tx.insert(...).returning()`
 * reads like a guaranteed row while `noUncheckedIndexedAccess` correctly calls it
 * `Row | undefined`. For an insert or an update that matched, the guarantee is real: the
 * statement throws on failure rather than returning nothing.
 *
 * The honest translation of that is neither a `!` — which deletes the question instead of
 * answering it — nor a `fail()` branch, which would be unreachable, untestable, and would
 * have to invent a user-facing sentence for something no user can cause. It is an
 * assertion that says out loud what is being assumed and, if that ever stops holding,
 * names the statement in the error rather than throwing `undefined is not an object` from
 * whichever line first read a field.
 *
 * Inside `db.transaction`, throwing rolls the transaction back, which is the behaviour a
 * half-written row wants anyway.
 *
 * Use this only where the statement itself guarantees the row. A `select` that may
 * legitimately find nothing is a 404, and that stays an ordinary
 * `if (!row) return fail(c, 'NOT_FOUND')`.
 */
export function returnedRow<T>(rows: T[], statement: string): T {
  const row = rows[0]
  if (row === undefined) {
    throw new Error(`${statement} returned no row`)
  }
  return row
}
