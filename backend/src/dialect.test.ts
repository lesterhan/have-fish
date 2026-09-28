/**
 * Holds gate G1 of phase P1 (#244): the backend's queries say nothing only Postgres
 * understands, so the SQLite port (P2) swaps a driver and a schema rather than rewriting
 * queries.
 *
 * - No raw query: `db.execute` does not exist on Drizzle's SQLite driver, and its rows come
 *   back as an unchecked cast. The query builder types the row and speaks both dialects.
 * - No Postgres-only text inside a `sql` template: a `::` cast (`::date`, `::int`),
 *   `to_char`, a `jsonb` operator or function, or `SUM(` over amounts, which #279 moved into
 *   integer cents in `money.ts`. Drizzle's own helpers (`count()`, `countDistinct()`) render
 *   for each dialect.
 *
 * `db/pg/` and `db/sqlite/` are the two folders allowed to speak their own dialect: each
 * holds one build's client and schema (#482), and nothing else imports them directly.
 *
 * Sources are read with TypeScript's parser rather than a grep, so a comment that mentions
 * `::` or `db.execute` changes nothing, and only a template actually tagged `sql` is read as SQL.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const SRC = import.meta.dir
const DIALECT_FOLDERS = ['db/pg/', 'db/sqlite/']

/** Postgres-only text a `sql` template may not contain, each with what to use instead. */
const POSTGRES_ONLY: [RegExp, string][] = [
  [/::\s*[a-z]/i, 'a `::` cast; Drizzle helpers such as count() map their own result'],
  [/\bto_char\s*\(/i, 'to_char; dates are YYYY-MM-DD text (#277)'],
  [/\bjsonb/i, 'jsonb; merge JSON in TypeScript (#278)'],
  [/\bsum\s*\(/i, 'SUM over amounts; add them in integer cents with money.sum (#279)'],
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [relative(SRC, path)] : []
  })
}

type Found = { file: string; line: number; text: string }

/** Every `sql` template's SQL text, and every `.execute(…)` and `sql.raw(…)` call. */
function scan(file: string, text = readFileSync(join(SRC, file), 'utf8')) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const at = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const templates: Found[] = []
  const raw: Found[] = []

  const visit = (node: ts.Node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === 'sql'
    ) {
      // The literal parts only: an interpolated `${column}` is Drizzle's to render.
      const t = node.template
      const text = ts.isNoSubstitutionTemplateLiteral(t)
        ? t.text
        : [t.head.text, ...t.templateSpans.map((s) => s.literal.text)].join(' ? ')
      templates.push({ file, line: at(node), text })
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'execute' ||
        (node.expression.name.text === 'raw' &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'sql'))
    ) {
      raw.push({ file, line: at(node), text: node.expression.getText() })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { templates, raw }
}

const FILES = sourceFiles(SRC)
  .filter((f) => !DIALECT_FOLDERS.some((folder) => f.startsWith(folder)))
  .sort()
const SCANNED = FILES.map((f) => scan(f))
const TEMPLATES = SCANNED.flatMap((s) => s.templates)
const RAW = SCANNED.flatMap((s) => s.raw)
const shown = (f: Found) => `${f.file}:${f.line} ${f.text.replace(/\s+/g, ' ').trim()}`

describe('the backend speaks both dialects', () => {
  it('runs no raw query, so every row shape is typed by the query builder', () => {
    expect(RAW.map(shown)).toEqual([])
  })

  for (const [pattern, instead] of POSTGRES_ONLY) {
    it(`writes no ${instead.split(';')[0]} in a sql template`, () => {
      const found = TEMPLATES.filter((t) => pattern.test(t.text))
      expect(found.map(shown)).toEqual([])
    })
  }

  it('reads the sql templates it checks, so the rules above are not vacuous', () => {
    expect(TEMPLATES.map(shown)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^accounts\/balance-service\.ts:\d+ MAX\( \? \)$/),
      ]),
    )
  })
})

describe('the scan', () => {
  const fixture = scan(
    'fixture.ts',
    [
      '// db.execute(sql`SELECT now()::date`) in a comment is not a query',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not an interpolation
      'const n = sql<number>`COUNT(${t.id})::int`',
      'await db.execute(sql`SELECT 1`)',
      'const r = sql.raw(`SELECT 1`)',
      'const s = `plain ::text is not sql`',
    ].join('\n'),
  )

  it('finds a cast in a sql template and only there', () => {
    const casts = fixture.templates.filter((t) => POSTGRES_ONLY[0]?.[0].test(t.text))
    expect(casts.map(shown)).toEqual(['fixture.ts:2 COUNT( ? )::int'])
  })

  it('finds db.execute and sql.raw, and not the comment', () => {
    expect(fixture.raw.map(shown)).toEqual(['fixture.ts:3 db.execute', 'fixture.ts:4 sql.raw'])
  })
})
