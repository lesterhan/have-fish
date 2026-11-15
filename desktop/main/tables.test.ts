/**
 * Only the ledger's own code writes its tables: `main/ledger/`, which keeps the versions,
 * tombstones and outbox, and `main/db/`, which opens and migrates the file. A write is a drizzle
 * `insert`, `update` or `delete` on a table imported from `db/schema`, or SQL text that writes
 * rows, read from TypeScript 5's parse as `layers.test.ts` reads imports.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript5'
import { describe, expect, it } from 'vitest'

const DESKTOP = fileURLToPath(new URL('..', import.meta.url))

const SOURCES = readdirSync(join(DESKTOP, 'main'), { recursive: true, encoding: 'utf8' })
  .map((f) => posix.join('main', f.split('\\').join('/')))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()

const isLedgerCode = (file: string) =>
  file.startsWith('main/ledger/') || file.startsWith('main/db/')
const outside = SOURCES.filter((f) => !isLedgerCode(f))
const inside = SOURCES.filter(isLedgerCode)

const read = (file: string) => readFileSync(join(DESKTOP, file), 'utf8')

/** SQLite's four statements that write rows, in any case, anywhere in a string. */
const WRITE_SQL =
  /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?\s+\S+\s+SET|DELETE\s+FROM)\b/i

const WRITE_BUILDERS = ['insert', 'update', 'delete']

/** Each write `source` makes to a ledger table, as `file:line what`. */
function writesIn(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const tables = new Set<string>()
  const schemas = new Set<string>()
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    const from = posix.join(posix.dirname(file), statement.moduleSpecifier.text)
    const bindings = statement.importClause?.namedBindings
    if (from !== 'main/db/schema' || bindings === undefined) continue
    if (ts.isNamespaceImport(bindings)) schemas.add(bindings.name.text)
    else for (const e of bindings.elements) tables.add(e.name.text)
  }

  const isTable = (node: ts.Node) =>
    (ts.isIdentifier(node) && tables.has(node.text)) ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      schemas.has(node.expression.text))

  const found: string[] = []
  const at = (node: ts.Node) => tree.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name } = node.expression
      const [table] = node.arguments
      if (WRITE_BUILDERS.includes(name.text) && table !== undefined && isTable(table)) {
        found.push(`${file}:${at(node)} ${name.text}(${table.getText()})`)
      }
    }
    const text = textOf(node)
    if (text !== undefined && WRITE_SQL.test(text)) found.push(`${file}:${at(node)} ${text.trim()}`)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

/** A string's text, with each substitution of a template as `?`. */
function textOf(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `?${span.literal.text}`).join('')
  }
  return undefined
}

describe('the ledger tables', () => {
  it('no source in main outside main/ledger/ and main/db/ writes a ledger table', () => {
    expect(outside).toEqual(
      expect.arrayContaining([
        'main/context.ts',
        'main/undo/steps.ts',
        'main/features/spends/spends.ts',
      ]),
    )
    expect(outside.filter((f) => isLedgerCode(f) || f.endsWith('.test.ts'))).toEqual([])
    expect(outside.flatMap((f) => writesIn(f, read(f)))).toEqual([])
  })

  it('the rule finds the writes main/ledger/ and main/db/ make', () => {
    const writing = inside.filter((f) => writesIn(f, read(f)).length > 0)
    expect(writing).toEqual(
      expect.arrayContaining([
        'main/db/clock.ts',
        'main/db/ledger.ts',
        'main/db/migrate.ts',
        'main/ledger/document-types.ts',
        'main/ledger/outbox.ts',
      ]),
    )
  })
})

describe('a write to a ledger table', () => {
  it('finds an insert on a table imported under another name', () => {
    const source =
      "import { accounts as a } from '../../db/schema'\nexport const f = (orm) => orm.insert(a).values({}).run()"
    expect(writesIn('main/features/accounts/accounts.ts', source)).toEqual([
      'main/features/accounts/accounts.ts:2 insert(a)',
    ])
  })

  it('finds a delete on the schema imported whole', () => {
    const source =
      "import * as schema from '../../db/schema'\nexport const f = (orm) => orm.delete(schema.outbox).run()"
    expect(writesIn('main/features/spends/spends.ts', source)).toEqual([
      'main/features/spends/spends.ts:2 delete(schema.outbox)',
    ])
  })

  it('finds an update outside a feature', () => {
    const source =
      "import { meta } from './db/schema'\nexport const f = (orm) => orm.update(meta).set({ clockCounter: 0 }).run()"
    expect(writesIn('main/context.ts', source)).toEqual(['main/context.ts:2 update(meta)'])
  })

  it('finds DELETE FROM in SQL text', () => {
    const source = "export const f = (db) => db.prepare('DELETE FROM postings').run()"
    expect(writesIn('main/features/reports/reports.ts', source)).toEqual([
      'main/features/reports/reports.ts:1 DELETE FROM postings',
    ])
  })

  it('finds an INSERT held in a constant, in any case', () => {
    const source =
      "const q = 'insert into transactions (id) values (?)'\nexport const f = (db) => db.prepare(q).run('x')"
    expect(writesIn('main/features/paths/paths.ts', source)).toEqual([
      'main/features/paths/paths.ts:1 insert into transactions (id) values (?)',
    ])
  })

  it("finds INSERT OR REPLACE in drizzle's sql tag", () => {
    const source =
      "import { sql } from 'drizzle-orm'\nexport const f = (orm) => orm.run(sql`INSERT OR REPLACE INTO accounts VALUES (1)`)"
    expect(writesIn('main/undo/steps.ts', source)).toEqual([
      'main/undo/steps.ts:2 INSERT OR REPLACE INTO accounts VALUES (1)',
    ])
  })

  it('finds REPLACE INTO', () => {
    const source = "export const f = (db) => db.prepare('REPLACE INTO meta (id) VALUES (1)').run()"
    expect(writesIn('main/machine.ts', source)).toEqual([
      'main/machine.ts:1 REPLACE INTO meta (id) VALUES (1)',
    ])
  })

  it('finds an UPDATE whose table is a substitution', () => {
    const source =
      "const T = 'meta'\nexport const f = (db) => db.exec(`UPDATE ${T} SET clockWallMs = 0`)"
    expect(writesIn('main/context.ts', source)).toEqual([
      'main/context.ts:2 UPDATE ? SET clockWallMs = 0',
    ])
  })

  it('a read is not a write', () => {
    const source =
      "import { accounts } from '../../db/schema'\nexport const f = (orm, db) => [orm.select().from(accounts).all(), db.prepare('SELECT * FROM accounts WHERE id = ?').get('x')]"
    expect(writesIn('main/features/accounts/accounts.ts', source)).toEqual([])
  })

  it("a Map's delete and an error's words are not writes", () => {
    const source =
      "import { accounts } from '../../db/schema'\nconst m = new Map()\nexport const f = (id) => { m.delete(id); if (!accounts) throw new Error('nothing to update, so it was set aside') }"
    expect(writesIn('main/features/accounts/accounts.ts', source)).toEqual([])
  })
})
