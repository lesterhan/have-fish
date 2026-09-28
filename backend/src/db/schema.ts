// The tables, in whichever dialect this build is for: `db/pg/schema.ts` or
// `db/sqlite/schema.ts` (see `db/index.ts`). The two declare the same tables and columns, and
// `db/schemas.test.ts` holds them to it.
export * from '#dialect/schema'
