/// <reference types="node" />
/**
 * Keeps the core pure. Every source file in `core/src` may import `zod` and its own files, and
 * nothing else: no database, no Electron, no Node, no network. So the same checks run on a
 * write, on a document that arrived from another device, and in a test, with nothing around them.
 *
 * Imports are read with TypeScript's own scanner (`preProcessFile`), as `backend/src/layers.test.ts`
 * does: it sees type-only imports and re-exports and ignores comments, so neither a stray
 * `from '…'` in a comment nor an `import type` changes the answer. TypeScript 7 has no
 * JavaScript API, so the scanner comes from TypeScript 5, installed as `typescript5` for this
 * file alone.
 *
 * This file reads the disk, so it needs Node's types; the reference above brings them in. The
 * source files can't use them anyway: the first test refuses a `node:` import.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript5'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

/** The packages a core file may import. A new one is a decision made in a diff. */
const PACKAGES = ['zod']

const FILES = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()
const SOURCE = new Map(FILES.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]))

const importsOf = (text: string) =>
  ts.preProcessFile(text, true, true).importedFiles.map((i) => i.fileName)

type Edge = { file: string; imports: string }
const EDGES: Edge[] = FILES.flatMap((file) =>
  importsOf(SOURCE.get(file) ?? '').map((imports) => ({ file, imports })),
)

const isPackage = (spec: string, name: string) => spec === name || spec.startsWith(`${name}/`)
const allowed = (spec: string) => spec.startsWith('.') || PACKAGES.some((p) => isPackage(spec, p))
const shown = (e: Edge) => `${e.file} → ${e.imports}`

// A pure function takes the time or a random value as a parameter instead of reading one.
// `new Date(text)` parses and is allowed; `new Date()` reads the clock and is not.
const READS_THE_WORLD =
  /\bDate\.now\s*\(|new Date\(\s*\)|\bMath\.random\s*\(|\bperformance\.now\s*\(/

describe('a core file', () => {
  it('imports nothing but zod and its own files', () => {
    expect(EDGES.filter((e) => !allowed(e.imports)).map(shown)).toEqual([])
  })

  it('reads no clock and no randomness', () => {
    expect(FILES.filter((f) => READS_THE_WORLD.test(SOURCE.get(f) ?? ''))).toEqual([])
  })

  it('is every source file, so the rules above are not vacuous', () => {
    expect(FILES).toEqual(expect.arrayContaining(['documents.ts', 'money.ts', 'postings.ts']))
    expect(EDGES.map(shown)).toEqual(
      expect.arrayContaining(['documents.ts → zod', 'documents.ts → ./postings']),
    )
  })
})

describe('the scanner', () => {
  it('sees type-only imports, re-exports and dynamic imports, and skips comments', () => {
    const text = [
      "// import { app } from 'electron'",
      "import type { Database } from 'better-sqlite3'",
      "export type { Stats } from 'node:fs'",
      "const later = () => import('node:path')",
    ].join('\n')
    expect(importsOf(text)).toEqual(['better-sqlite3', 'node:fs', 'node:path'])
  })
})
