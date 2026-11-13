/**
 * Keeps main's features apart and the window out of main. A feature in `main/features/<name>/`
 * stands on the core (the rest of `main/`), `shared/`, `copy/` and its own files, never on another
 * feature, and only the registry assembles them, from their `commands.ts`. Their schemas in
 * `shared/commands/` keep apart the same way: only its index assembles them. Neither feature nor
 * schema reaches the registry, what runs it, or the index, since each holds them all. The window,
 * the sheet, the scenes, the preload, `copy/` and `shared/` import nothing from `main/`: that
 * split is a security boundary.
 *
 * The window's files keep to layers, each importing only those under it: the root, `parts/`,
 * `ledger/`, a place in `places/<name>/` (never another place), then `shell/`, which may import
 * any. A root file or a part names no command. A rule module beside a component stays free of the
 * DOM, so the rules could run without a page.
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

/** A feature's file of schemas in `shared/commands/`: every one but the index and wire.ts. */
const isSharedFeature = (path: string) => /^shared\/commands\/(?!index$|wire$)[^/]+$/.test(path)

/** What collects every feature, so a feature reaching it reaches them all. */
const SHARED_INDEX = ['shared/commands', 'shared/commands/index']
const SHARED_INDEX_FILE = 'shared/commands/index.ts'
const RUNS_FEATURES = ['main/commands/registry', 'main/commands/run']

const shown = (e: Edge) => `${e.file} → ${e.imports}`

/**
 * The files directly in `renderer/` that every layer may use; tests are free of the layers. Its
 * `public/`, Vite's static folder of licence texts, holds no source and sits outside the layers.
 */
const ROOT = [
  'density.ts',
  'env.d.ts',
  'fonts.css',
  'format.ts',
  'index.html',
  'main.ts',
  'narrow.ts',
  'shortcuts.ts',
  'tokens.css',
]

/** The root's names without their extensions, which an import may leave off. */
const ROOT_STEMS = ROOT.map((name) => name.replace(/\.[^.]+$/, ''))

/** Whether a name in `renderer/` is a root file, or an import of one. */
function atRoot(name: string): boolean {
  if (ROOT.includes(name)) return true
  return !name.includes('.') && ROOT_STEMS.includes(name)
}

type Layer = { layer: 'root' | 'parts' | 'ledger' | 'shell' } | { layer: 'place'; name: string }

/** Where a window file sits, from its path under desktop/; undefined for any other path. */
function layerOf(path: string): Layer | undefined {
  const rest = /^renderer\/(.+)$/.exec(path)?.[1]
  if (rest === undefined) return undefined
  if (!rest.includes('/')) return atRoot(rest) ? { layer: 'root' } : undefined
  const folder = rest.split('/')[0]
  if (folder === 'parts' || folder === 'ledger' || folder === 'shell') return { layer: folder }
  const name = /^places\/([^/]+)\/./.exec(rest)?.[1]
  return name === undefined ? undefined : { layer: 'place', name }
}

/** The layers from the bottom: each may import those before it, and a place only its own. */
const LAYERS = ['root', 'parts', 'ledger', 'place', 'shell'] as const

function mayUse(from: Layer, to: Layer | undefined): boolean {
  if (from.layer === 'shell') return true
  if (to === undefined) return false
  if (to.layer === 'place') return from.layer === 'place' && from.name === to.name
  return LAYERS.indexOf(to.layer) <= LAYERS.indexOf(from.layer)
}

/** A root file's one import past the root's rule: the entry mounts the shell, Bridge types it. */
const ROOT_EXCEPTIONS = [
  { file: 'renderer/main.ts', to: 'renderer/shell/App.svelte' },
  { file: 'renderer/env.d.ts', to: 'shared/commands' },
]

const isCommands = (path: string) =>
  path === 'shared/commands' || path.startsWith('shared/commands/')

/** Whether a window file's import, landing at `to`, is on a layer it may not use. */
function breaksLayers(file: string, to: string): boolean {
  const from = layerOf(file)
  if (from === undefined) return false
  if (ROOT_EXCEPTIONS.some((e) => e.file === file && e.to === to)) return false
  if (to.startsWith('renderer/')) return !mayUse(from, layerOf(to))
  return isCommands(to) && (from.layer === 'root' || from.layer === 'parts')
}

function breaks(edge: Edge): boolean {
  const to = target(edge)
  if (isTest(edge.file) || to === undefined) return false
  if (breaksLayers(edge.file, to)) return true
  const from = featureOf(edge.file)
  const into = featureOf(`${to}/`)
  if (from !== undefined && RUNS_FEATURES.includes(to)) return true
  const schemaFile = edge.file.startsWith('shared/commands/') && edge.file !== SHARED_INDEX_FILE
  if (schemaFile && (isSharedFeature(to) || SHARED_INDEX.includes(to))) return true
  if (into !== undefined && from !== undefined) return from !== into
  if (into !== undefined) return edge.file !== REGISTRY || to !== `main/features/${into}/commands`
  return OUTSIDE_MAIN.includes(edge.file.split('/')[0] ?? '') && to.split('/')[0] === 'main'
}

/** Each import that breaks a rule, as `file → import`. */
function problemsIn(edges: Edge[]): string[] {
  return edges.filter(breaks).map(shown)
}

/** The window's files with no layer. */
const unplacedIn = (files: string[]) => files.filter((f) => layerOf(f) === undefined)

const GLOBALS = ['document', 'window']

/** Whether an identifier is a property's name: `x.window`, `{ window: 1 }`, `{ window: T }`. */
function namesProperty(node: ts.Identifier): boolean {
  const { parent } = node
  return (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  )
}

/** Each use of the identifier `document` or `window`, read from the parsed tree. */
function globalsIn(source: string): string[] {
  const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true)
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && GLOBALS.includes(node.text) && !namesProperty(node)) {
      hits.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

/** Each way a source touches the DOM: an import of svelte, or the global document or window. */
function domTouchesIn(source: string): string[] {
  const svelte = importsOf(source).filter((spec) => spec === 'svelte' || spec.startsWith('svelte/'))
  return [...svelte, ...globalsIn(source)]
}

/** The window's modules that must touch the DOM: the density, the entry, and the floating box. */
const TOUCH_DOM = ['renderer/density.ts', 'renderer/main.ts', 'renderer/parts/floating.ts']

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

  it('refuse the registry importing anything of a feature but its commands', () => {
    const edge = { file: REGISTRY, imports: '../features/accounts/accounts' }
    expect(problemsIn([edge])).toEqual([
      'main/commands/registry.ts → ../features/accounts/accounts',
    ])
  })

  it("refuse a feature's shared file importing another feature's", () => {
    const edge = { file: 'shared/commands/reports.ts', imports: './spends' }
    expect(problemsIn([edge])).toEqual(['shared/commands/reports.ts → ./spends'])
  })

  it("refuse wire.ts importing a feature's shared file", () => {
    const edge = { file: 'shared/commands/wire.ts', imports: './spends' }
    expect(problemsIn([edge])).toEqual(['shared/commands/wire.ts → ./spends'])
  })

  it("let only index.ts in shared/commands import a feature's file", () => {
    const edges = [
      { file: 'shared/commands/spends.ts', imports: './wire' },
      { file: 'shared/commands/index.ts', imports: './spends' },
      { file: 'shared/steps.ts', imports: './commands/spends' },
    ]
    expect(problemsIn(edges)).toEqual([])
  })

  it('refuse a file in shared/commands reaching another feature through the index', () => {
    const edges = [
      { file: 'shared/commands/reports.ts', imports: '.' },
      { file: 'shared/commands/reports.ts', imports: './index' },
    ]
    expect(problemsIn(edges)).toEqual(edges.map(shown))
  })

  it('refuse a feature reaching another through the registry or what runs it', () => {
    const edges = [
      { file: 'main/features/reports/reports.ts', imports: '../../commands/registry' },
      { file: 'main/features/reports/reports.ts', imports: '../../commands/run' },
    ]
    expect(problemsIn(edges)).toEqual(edges.map(shown))
  })

  it('let a test arrange through another feature', () => {
    const edge = { file: 'main/features/accounts/accounts.test.ts', imports: '../spends/spends' }
    expect(problemsIn([edge])).toEqual([])
  })

  it('refuse the window, sheet, scenes, preload, copy and shared importing main', () => {
    const edges = [
      { file: 'renderer/places/reports/Reports.svelte', imports: '../../../main/db/ledger' },
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
      "  import { openLedger } from '../../../main/db/ledger'",
      '</script>',
      "<p>import { app } from '../../../main/index'</p>",
    ].join('\n')
    expect(edgesOf('renderer/places/reports/Reports.svelte', source)).toEqual([
      { file: 'renderer/places/reports/Reports.svelte', imports: '../../../main/db/ledger' },
    ])
  })

  it('read every source file, so the rules above are not vacuous', () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        'main/features/spends/commands.ts',
        'renderer/places/reports/Reports.svelte',
        'renderer/ledger/ledger.ts',
        'renderer/parts/Listbox.svelte',
        'renderer/shell/App.svelte',
        'renderer/format.ts',
        'shared/commands/index.ts',
      ]),
    )
    const features = ['spends', 'accounts', 'paths', 'reports', 'settings', 'clipboard']
    expect(EDGES.map(shown)).toEqual(
      expect.arrayContaining(features.map((f) => `${REGISTRY} → ../features/${f}/commands`)),
    )
  })
})

describe("the window's layers", () => {
  it('refuse a place importing another place', () => {
    const edge = { file: 'renderer/places/spends/Spends.svelte', imports: '../reports/report' }
    expect(problemsIn([edge])).toEqual(['renderer/places/spends/Spends.svelte → ../reports/report'])
  })

  it('let a place import its own files, the ledger, the parts and the root', () => {
    const edges = [
      { file: 'renderer/places/accounts/Accounts.svelte', imports: './balances' },
      { file: 'renderer/places/reports/Reports.svelte', imports: '../../ledger/SpendList.svelte' },
      { file: 'renderer/places/reports/report.ts', imports: '../../parts/listbox' },
      { file: 'renderer/places/spends/Spends.svelte', imports: '../../format' },
    ]
    expect(problemsIn(edges)).toEqual([])
  })

  it('refuse a place importing the shell', () => {
    const edge = { file: 'renderer/places/reports/Reports.svelte', imports: '../../shell/places' }
    expect(problemsIn([edge])).toHaveLength(1)
  })

  it('refuse a part importing the commands', () => {
    const edges = [
      { file: 'renderer/parts/Band.svelte', imports: '../../shared/commands' },
      { file: 'renderer/parts/Money.svelte', imports: '../../shared/commands/wire' },
    ]
    expect(problemsIn(edges)).toEqual(edges.map(shown))
  })

  it('refuse a part importing the ledger, a place or the shell', () => {
    const edges = [
      { file: 'renderer/parts/Day.svelte', imports: '../ledger/sentence' },
      { file: 'renderer/parts/Row.svelte', imports: '../places/reports/report' },
      { file: 'renderer/parts/Keys.svelte', imports: '../shell/places' },
    ]
    expect(problemsIn(edges)).toEqual(edges.map(shown))
  })

  it('let a part import the root, copy, shared and the parts', () => {
    const edges = [
      { file: 'renderer/parts/Day.svelte', imports: '../format' },
      { file: 'renderer/parts/Day.svelte', imports: '../../copy' },
      { file: 'renderer/parts/Keys.svelte', imports: '../../shared/actions' },
      { file: 'renderer/parts/Band.svelte', imports: '../../shared/currency' },
      { file: 'renderer/parts/Listbox.svelte', imports: './Row.svelte' },
    ]
    expect(problemsIn(edges)).toEqual([])
  })

  it('refuse the ledger importing a place or the shell', () => {
    const edges = [
      { file: 'renderer/ledger/query.ts', imports: '../places/reports/report' },
      { file: 'renderer/ledger/SpendList.svelte', imports: '../shell/places' },
    ]
    expect(problemsIn(edges)).toEqual(edges.map(shown))
  })

  it('let the ledger import the parts, the commands and its own files', () => {
    const edges = [
      { file: 'renderer/ledger/SpendCard.svelte', imports: '../parts/Card.svelte' },
      { file: 'renderer/ledger/ledger.ts', imports: '../../shared/commands' },
      { file: 'renderer/ledger/spendActions.ts', imports: './refusals' },
    ]
    expect(problemsIn(edges)).toEqual([])
  })

  it('refuse a root file importing the commands, but not the currency or the actions', () => {
    const edge = { file: 'renderer/format.ts', imports: '../shared/commands' }
    expect(problemsIn([edge])).toEqual(['renderer/format.ts → ../shared/commands'])
    const edges = [
      { file: 'renderer/format.ts', imports: '../shared/currency' },
      { file: 'renderer/shortcuts.ts', imports: '../shared/actions' },
    ]
    expect(problemsIn(edges)).toEqual([])
  })

  it('refuse a root file importing a part or the ledger', () => {
    const edges = [
      { file: 'renderer/format.ts', imports: './parts/listbox' },
      { file: 'renderer/shortcuts.ts', imports: './ledger/ledger' },
    ]
    expect(problemsIn(edges)).toEqual(edges.map(shown))
  })

  it("let main.ts import the shell's App and nothing else of it, and env.d.ts the commands", () => {
    const edges = [
      { file: 'renderer/main.ts', imports: './shell/App.svelte' },
      { file: 'renderer/env.d.ts', imports: '../shared/commands' },
    ]
    expect(problemsIn(edges)).toEqual([])
    const edge = { file: 'renderer/main.ts', imports: './ledger/ledger' }
    expect(problemsIn([edge])).toEqual(['renderer/main.ts → ./ledger/ledger'])
  })

  it('let the shell import any layer', () => {
    const edges = [
      { file: 'renderer/shell/App.svelte', imports: '../places/spends/Spends.svelte' },
      { file: 'renderer/shell/Sidebar.svelte', imports: './places' },
      { file: 'renderer/shell/App.svelte', imports: '../ledger/ledger' },
    ]
    expect(problemsIn(edges)).toEqual([])
  })

  it('let a test arrange through a place', () => {
    const edge = { file: 'renderer/ledger/query.test.ts', imports: '../places/reports/report' }
    expect(problemsIn([edge])).toEqual([])
  })

  it('place a file by its folder, and a file outside the layers nowhere', () => {
    expect(layerOf('renderer/Thing.svelte')).toBeUndefined()
    expect(layerOf('renderer/tokens.ts')).toBeUndefined()
    expect(layerOf('renderer/index.ts')).toBeUndefined()
    expect(layerOf('renderer/format.ts')).toEqual({ layer: 'root' })
    expect(layerOf('renderer/places/reports/report.ts')).toEqual({
      layer: 'place',
      name: 'reports',
    })
    expect(layerOf('renderer/places/report.ts')).toBeUndefined()
  })

  it('give every file in renderer/ a layer', () => {
    const windowFiles = FILES.filter((f) => f.startsWith('renderer/') && !isTest(f))
    expect(windowFiles).not.toEqual([])
    expect(unplacedIn(windowFiles)).toEqual([])
    expect(unplacedIn([...windowFiles, 'renderer/Thing.svelte'])).toEqual(['renderer/Thing.svelte'])
  })
})

describe('the DOM guard', () => {
  it('find an import of svelte, and not of a file named like it', () => {
    expect(domTouchesIn("import { tick } from 'svelte'")).toEqual(['svelte'])
    expect(domTouchesIn("import { writable } from 'svelte/store'")).toEqual(['svelte/store'])
    expect(domTouchesIn("import { x } from './svelte-ish'")).toEqual([])
  })

  it('find the globals document and window', () => {
    expect(domTouchesIn('const el = document.body')).toEqual(['document'])
    expect(domTouchesIn('window.haveFish.invoke(name)')).toEqual(['window'])
  })

  it('pass the words in a comment, a string, a property and a key', () => {
    const source = [
      '// the window shows it',
      "const a = 'window'",
      'const b = place.window',
      'const c = { document: 1 }',
      'type P = { window: number }',
    ].join('\n')
    expect(domTouchesIn(source)).toEqual([])
  })

  it("tell a template's text and a regular expression from code", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source read holds a template
    expect(domTouchesIn('const a = `${b} window`')).toEqual([])
    expect(domTouchesIn('const r = /window/')).toEqual([])
    expect(domTouchesIn('const c = a ? window : b')).toEqual(['window'])
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source read holds a template
    expect(domTouchesIn('const d = `${window.x}`')).toEqual(['window'])
  })

  it('hold for every rule module in the window today, and need its exception for density.ts', () => {
    const modules = FILES.filter(
      (f) => f.startsWith('renderer/') && f.endsWith('.ts') && !isTest(f) && !f.endsWith('.d.ts'),
    )
    expect(modules).toEqual(expect.arrayContaining(['renderer/ledger/ledger.ts']))
    const touching = modules
      .filter((f) => !TOUCH_DOM.includes(f))
      .filter((f) => domTouchesIn(readFileSync(join(DESKTOP, f), 'utf8')).length > 0)
    expect(touching).toEqual([])
    const density = readFileSync(join(DESKTOP, 'renderer/density.ts'), 'utf8')
    expect(domTouchesIn(density).length).toBeGreaterThan(0)
  })
})
