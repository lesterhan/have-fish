// The two schemas declare the same database (#482). Every service is written once against
// `db/schema.ts`, so a column, index or constraint that exists in one dialect's schema and not
// the other's is a query that works in one build and fails in the other. This compares them
// through Drizzle's own table configs: names, nullability, defaults, keys, indexes, checks and
// foreign keys. Column types are the one thing allowed to differ, and the per-dialect type
// check is what holds those to the same TypeScript types.

import { describe, expect, it } from 'bun:test'
import { getTableName, is } from 'drizzle-orm'
import { PgTable, getTableConfig as pgConfig } from 'drizzle-orm/pg-core'
import { SQLiteTable, getTableConfig as sqliteConfig } from 'drizzle-orm/sqlite-core'
import * as pg from './pg/schema'
import * as sqlite from './sqlite/schema'

type Config = ReturnType<typeof pgConfig> | ReturnType<typeof sqliteConfig>

/** What a table promises a query, in a form both dialects can be compared in. */
function shape(config: Config) {
  const columnName = (c: { name: string }) => c.name
  return {
    columns: config.columns
      .map((c) => ({
        name: c.name,
        notNull: c.notNull,
        primary: c.primary,
        unique: c.isUnique,
        hasDefault: c.hasDefault || c.defaultFn !== undefined,
        onUpdate: c.onUpdateFn !== undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    indexes: config.indexes
      .map((i) => ({
        name: i.config.name,
        unique: i.config.unique,
        on: i.config.columns.map((c) => ('name' in c ? c.name : '(expression)')),
        partial: i.config.where !== undefined,
      }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    uniques: config.uniqueConstraints
      .map((u) => ({ name: u.name, on: u.columns.map(columnName) }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    checks: config.checks.map((c) => c.name).sort(),
    foreignKeys: config.foreignKeys
      .map((f) => {
        const ref = f.reference()
        return {
          from: ref.columns.map(columnName),
          to: `${getTableName(ref.foreignTable)}(${ref.foreignColumns.map(columnName).join(', ')})`,
          onDelete: f.onDelete ?? 'no action',
        }
      })
      .sort((a, b) => a.from.join().localeCompare(b.from.join())),
  }
}

const PG = new Map(
  Object.entries(pg).flatMap(([name, value]) => (is(value, PgTable) ? [[name, value]] : [])),
)
const SQLITE = new Map(
  Object.entries(sqlite).flatMap(([name, value]) =>
    is(value, SQLiteTable) ? [[name, value]] : [],
  ),
)

describe('the Postgres and SQLite schemas', () => {
  it('export the same tables', () => {
    expect([...SQLITE.keys()].sort()).toEqual([...PG.keys()].sort())
    expect(PG.size).toBeGreaterThan(15)
  })

  for (const [name, table] of PG) {
    it(`declare ${name} the same way`, () => {
      const other = SQLITE.get(name)
      if (!other) throw new Error(`SQLite schema has no ${name}`)
      expect(getTableName(other)).toBe(getTableName(table))
      expect(shape(sqliteConfig(other))).toEqual(shape(pgConfig(table)))
    })
  }

  it('reads what it compares, so a match is not two empty lists', () => {
    const accounts = shape(pgConfig(pg.accounts))
    expect(accounts.indexes).toContainEqual({
      name: 'accounts_user_path_key_idx',
      unique: true,
      on: ['user_id', 'path_key'],
      partial: true,
    })
    expect(shape(pgConfig(pg.importRules)).checks).toContain('import_rules_one_target')
    expect(shape(pgConfig(pg.postings)).foreignKeys.length).toBeGreaterThan(0)
  })
})
