/**
 * Keeps main's features apart and the window out of main. A feature in `main/features/<name>/`
 * stands on the core (the rest of `main/`), `shared/`, `copy/` and its own files, never on another
 * feature, and only the registry assembles them. The window, the sheet, the scenes, the preload,
 * `copy/` and `shared/` import nothing from `main/`: that split is a security boundary.
 *
 * Imports are read with TypeScript 5's scanner, as `core/src/layers.test.ts` does, and a
 * component's from its scripts alone. A test may arrange through another feature, so the rules
 * hold source files only.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import ts from 'typescript5'
import { describe, expect, it } from 'vitest'

const DESKTOP = fileURLToPath(new URL('..', import.meta.url))

/** What runs outside main, or is read by both sides: none of it may reach into main. */
const OUTSIDE_MAIN = ['renderer', 'sheet', 'scenes', 'preload', 'copy', 'shared']

const REGISTRY = 'main/commands/registry.ts'

type Edge = { file: string; imports: string }

const importsOf = (text: string) =>
  ts.preProcessFile(text, true, true).importedFiles.map((i) => i.fileName)

/** A component's imports, from its scripts and not its markup. */
function svelteImportsOf(source: string): string[] {
  const { instance, module } = parse(source, { modern: true })
  return [module, instance].flatMap((script) => {
    if (!script) return []
    // estree's Program doesn't type the offsets Svelte's parser puts on it.
    const { start, end } = script.content as typeof script.content & { start: number; end: number }
    return importsOf(source.slice(start, end))
  })
}

function edgesOf(file: string, source: string): Edge[] {
  const imports = file.endsWith('.svelte') ? svelteImportsOf(source) : importsOf(source)
  return imports.map((spec) => ({ file, imports: spec }))
}

const FILES = ['main', ...OUTSIDE_MAIN]
  .flatMap((dir) =>
    readdirSync(join(DESKTOP, dir), { recursive: true, encoding: 'utf8' }).map((f) =>
      posix.join(dir, f.split('\\').join('/')),
    ),
  )
  .filter((f) => f.endsWith('.ts') || f.endsWith('.svelte'))
  .sort()

const EDGES = FILES.flatMap((file) => edgesOf(file, readFileSync(join(DESKTOP, file), 'utf8')))

const isTest = (file: string) => /\.test\.ts$/.test(file)

/** Where a relative import lands, from desktop's root; undefined for a package. */
const target = ({ file, imports }: Edge) =>
  imports.startsWith('.') ? posix.join(posix.dirname(file), imports) : undefined

const featureOf = (path: string) => /^main\/features\/([^/]+)\//.exec(path)?.[1]

const shown = (e: Edge) => `${e.file} → ${e.imports}`

function breaks(edge: Edge): boolean {
  const to = target(edge)
  if (isTest(edge.file) || to === undefined) return false
  const from = featureOf(edge.file)
  const into = featureOf(`${to}/`)
  if (into !== undefined && from !== undefined) return from !== into
  if (into !== undefined) return edge.file !== REGISTRY
  return OUTSIDE_MAIN.includes(edge.file.split('/')[0] ?? '') && to.split('/')[0] === 'main'
}

/** Each import that breaks a rule, as `file → import`. */
function problemsIn(edges: Edge[]): string[] {
  return edges.filter(breaks).map(shown)
}

describe('the boundaries', () => {
  it('hold for every import in desktop today', () => {
    expect(problemsIn(EDGES)).toEqual([])
  })

  it('refuse a feature importing another feature', () => {
    const edge = { file: 'main/features/spends/spends.ts', imports: '../accounts/accounts' }
    expect(problemsIn([edge])).toEqual(['main/features/spends/spends.ts → ../accounts/accounts'])
  })

  it('refuse the core importing a feature', () => {
    const edge = { file: 'main/ledger/apply.ts', imports: '../features/spends/spends' }
    expect(problemsIn([edge])).toEqual(['main/ledger/apply.ts → ../features/spends/spends'])
  })

  it('let the registry import a feature', () => {
    expect(problemsIn([{ file: REGISTRY, imports: '../features/spends/commands' }])).toEqual([])
  })

  it('let a test arrange through another feature', () => {
    const edge = { file: 'main/features/accounts/accounts.test.ts', imports: '../spends/spends' }
    expect(problemsIn([edge])).toEqual([])
  })

  it('refuse the window, sheet, scenes, preload, copy and shared importing main', () => {
    const edges = [
      { file: 'renderer/Reports.svelte', imports: '../main/db/ledger' },
      { file: 'shared/commands/index.ts', imports: '../../main/db/ledger' },
      { file: 'sheet/main.ts', imports: '../main/db/ledger' },
      { file: 'scenes/bridge.ts', imports: '../main/db/ledger' },
      { file: 'preload/index.ts', imports: '../main/db/ledger' },
      { file: 'copy/index.ts', imports: '../main/db/ledger' },
    ]
    expect(problemsIn(edges)).toEqual(edges.map(shown))
  })

  it("read a component's imports from its script, not its markup", () => {
    const source = [
      '<script lang="ts">',
      "  import { openLedger } from '../main/db/ledger'",
      '</script>',
      "<p>import { app } from '../main/index'</p>",
    ].join('\n')
    expect(edgesOf('renderer/Reports.svelte', source)).toEqual([
      { file: 'renderer/Reports.svelte', imports: '../main/db/ledger' },
    ])
  })

  it('read every source file, so the rules above are not vacuous', () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        'main/features/spends/commands.ts',
        'renderer/Reports.svelte',
        'shared/commands/index.ts',
      ]),
    )
    const features = ['spends', 'accounts', 'paths', 'reports', 'settings', 'clipboard']
    expect(EDGES.map(shown)).toEqual(
      expect.arrayContaining(features.map((f) => `${REGISTRY} → ../features/${f}/commands`)),
    )
  })

  it('see registry.ts and shared/commands/index.ts only assemble: neither writes a handler or a schema', () => {
    expect(readFileSync(join(DESKTOP, REGISTRY), 'utf8')).not.toContain('=>')
    expect(readFileSync(join(DESKTOP, 'shared/commands/index.ts'), 'utf8')).not.toContain('z.')
  })
})
