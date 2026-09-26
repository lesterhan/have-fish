/**
 * Keeps the ledger write service the only writer of transactions and postings.
 *
 * Every transaction the app writes, from a request, an import row, a Fish Pie expense or
 * a settlement, goes through `ledger/write-service.ts`, so every one passes the same
 * validation: at least two postings, supported currencies, balanced per currency, accounts
 * that belong to the transaction's owner. A new `insert(postings)` anywhere else would be
 * a path around those rules, and the day it lands this test says so.
 *
 * Modelled on `routes/bodies.test.ts`, which reads route sources for the same reason.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dir, '..')
const SERVICE = 'ledger/write-service.ts'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

// `.insert(postings)` and `.insert(transactions)`, allowing the whitespace and line break
// a formatter may put between the call and its argument.
const INSERT = /\.insert\(\s*(postings|transactions)\s*\)/g

function inserts(): { file: string; table: string }[] {
  return sourceFiles(SRC).flatMap((path) => {
    const file = relative(SRC, path)
    return [...readFileSync(path, 'utf8').matchAll(INSERT)].map((m) => ({
      file,
      table: m[1] ?? '',
    }))
  })
}

describe('the ledger write service', () => {
  it('is the only place transactions and postings are inserted', () => {
    const elsewhere = inserts().filter((i) => i.file !== SERVICE)
    expect(elsewhere).toEqual([])
  })

  it('does insert both, so the rule above is not vacuous', () => {
    const tables = inserts()
      .filter((i) => i.file === SERVICE)
      .map((i) => i.table)
    expect(new Set(tables)).toEqual(new Set(['postings', 'transactions']))
  })
})
