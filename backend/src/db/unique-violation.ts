/**
 * Whether `err` is a unique index refusing a row, on either build's driver.
 *
 * A service that checks before it inserts still loses a race: two requests can both read "not
 * there yet", and the index turns the second insert into a thrown error. This is how that
 * service tells the refusal it expected from a failure it did not, and answers the first with
 * the same code its check would have. Drizzle wraps the driver's error, so the chain of
 * `cause`s is walked rather than the top one read.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    const { code, extendedCode } = e as { code?: unknown; extendedCode?: unknown }
    // Postgres's SQLSTATE for unique_violation; libsql's extended result code.
    if (code === '23505' || extendedCode === 'SQLITE_CONSTRAINT_UNIQUE') return true
  }
  return false
}
