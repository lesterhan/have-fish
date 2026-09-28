import type { db } from '#dialect/client'

// `#dialect/*` is a build condition, not a runtime switch (package.json `imports`): the server
// build resolves it to `db/pg/`, and a build given `--conditions=sqlite` to `db/sqlite/`. Each
// build type-checks the whole backend against its own dialect's client and schema
// (`bun run check` runs tsc once per dialect), so no query is ever typed as the other one's.
// Everything else imports the database from here and from `db/schema.ts`, never from
// `#dialect` directly.
export { db, dialect, forUpdate } from '#dialect/client'

/** An open database transaction, as `db.transaction(async (tx) => …)` hands it over. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Whatever a query can run on: the client itself, or a transaction someone else opened.
 * A function that writes as part of a larger unit of work takes one of these rather than
 * opening its own, so the caller decides where the unit begins and ends.
 */
export type Executor = typeof db | DbTransaction
