import { readFileSync } from 'node:fs'
import { DOCUMENT_TYPES } from '@have-fish/core/documents'
import ts from 'typescript5'
import { describe, expect, it } from 'vitest'
import { ALL_KINDS, type TraitsTable } from '../../shared/traits'

const specifierOf = (spec: ts.Expression | undefined) =>
  spec !== undefined && ts.isStringLiteral(spec) ? [spec.text] : []

/** Each import or re-export that loads its module at run time, by its specifier. */
function valueImportsIn(source: string): string[] {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest)
  return file.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
      return specifierOf(statement.moduleSpecifier)
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      return specifierOf(statement.moduleSpecifier)
    }
    return []
  })
}

// `bun run check` compiles these: each `@ts-expect-error` fails it if the line ever compiles.
describe('the table of traits', () => {
  it('missing a command is a compile error', () => {
    const partial = {} as Omit<TraitsTable, 'clipboard.copy'>
    // @ts-expect-error: `clipboard.copy` has no traits.
    const table: TraitsTable = partial
    expect(table).toBe(partial)
  })

  it('names every kind of document', () => {
    expect([...ALL_KINDS].sort()).toEqual(Object.keys(DOCUMENT_TYPES).sort())
  })
})

describe('valueImportsIn', () => {
  it('leaves out a type-only import', () => {
    expect(valueImportsIn("import type { A } from './a'")).toEqual([])
  })

  it('counts an import whose names are each a type, as it still loads its module', () => {
    expect(valueImportsIn("import { type A } from './a'")).toEqual(['./a'])
  })

  it('counts an import of a value', () => {
    expect(valueImportsIn("import { z } from 'zod'")).toEqual(['zod'])
  })

  it('counts an import for its side effects', () => {
    expect(valueImportsIn("import './side'")).toEqual(['./side'])
  })

  it('counts a re-export, and leaves out a type-only one', () => {
    expect(valueImportsIn("export * from './a'")).toEqual(['./a'])
    expect(valueImportsIn("export type { A } from './a'")).toEqual([])
  })

  it('finds none in shared/traits.ts, so the window loads no zod with it', () => {
    const source = readFileSync(new URL('../../shared/traits.ts', import.meta.url), 'utf8')
    expect(valueImportsIn(source)).toEqual([])
  })
})
