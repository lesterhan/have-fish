// Finds words typed into code instead of read from `copy/`. Markup is read with Svelte's own
// parser and code with TypeScript 5's, so the check knows where a string sits rather than
// guessing from the line it is on. TypeScript 7 has no API; `core/src/layers.test.ts` does the
// same. `copy/copy.test.ts` runs this over the app.

import { parse } from 'svelte/compiler'
import ts from 'typescript5'

export type Found = { text: string; line: number }

/** `KeyboardEvent.key` values: capitalised, and not words. */
const KEY_NAMES = new Set([
  'Alt',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'Control',
  'Delete',
  'End',
  'Enter',
  'Escape',
  'Home',
  'Meta',
  'PageDown',
  'PageUp',
  'Shift',
  'Tab',
])

/** A CSS declaration or media feature, handed to the page from code: `(max-width: 44rem)`. */
const CSS = /^\(?[a-z-]+\s*:\s*[^:]+?\)?;?$/

/** A key combination in Electron's form: `CmdOrCtrl+Shift+Z`. */
const ACCELERATOR = /^([A-Za-z]+\+)+\S+$/

/**
 * Whether a string in code reads as words: two or more of them, or one capitalised like a
 * label. A path, a selector, CSS, a key combination or a built string is not. One lowercase word (`'nearest'`) is
 * wiring, which means a one-word label in lowercase gets past; the markup check has no such gap.
 */
export function isWords(text: string): boolean {
  const t = text.trim()
  if (!/\p{L}/u.test(t) || /[/$[\]{}<>=]/.test(t) || CSS.test(t) || ACCELERATOR.test(t))
    return false
  if (/\s/.test(t) && (t.match(/\p{L}{2,}/gu) ?? []).length >= 2) return true
  return /^\p{Lu}\p{Ll}/u.test(t) && !/\s/.test(t) && !KEY_NAMES.has(t)
}

/** Attributes whose value a person reads or hears. The rest (`name`, `class`, `role`) are wiring. */
const SPOKEN = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
])

// Svelte's own node types. Anything else in its tree is a JavaScript expression or pattern.
const TEMPLATE = new Set([
  'AnimateDirective',
  'AttachTag',
  'Attribute',
  'AwaitBlock',
  'BindDirective',
  'ClassDirective',
  'Comment',
  'Component',
  'ConstTag',
  'DebugTag',
  'EachBlock',
  'ExpressionTag',
  'Fragment',
  'HtmlTag',
  'IfBlock',
  'KeyBlock',
  'LetDirective',
  'OnDirective',
  'RegularElement',
  'RenderTag',
  'SlotElement',
  'SnippetBlock',
  'SpreadAttribute',
  'StyleDirective',
  'SvelteBody',
  'SvelteBoundary',
  'SvelteComponent',
  'SvelteDocument',
  'SvelteElement',
  'SvelteFragment',
  'SvelteHead',
  'SvelteSelf',
  'SvelteWindow',
  'Text',
  'TitleElement',
  'TransitionDirective',
  'UseDirective',
])

type Node = { type: string; start: number; end: number; [key: string]: unknown }

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'

const lineAt = (source: string, offset: number) => source.slice(0, offset).split('\n').length

/** A piece of a component's code, and where in the component its first character is. */
type Code = { text: string; at: number }

/**
 * Hardcoded words in a component: any text with a letter in it, a literal on an attribute a
 * person reads, and words in its script and expressions. Styles and comments aren't read.
 */
export function wordsInSvelte(source: string): Found[] {
  const { markup, code } = readSvelte(source)
  const inCode = code.flatMap((c) =>
    literalWords(c.text).map((w) => ({ text: w.text, line: lineAt(source, c.at + w.at) })),
  )
  return [...markup, ...inCode].sort((a, b) => a.line - b.line)
}

/** Every path a component reads from `copy`, as far as its property names go. */
export function copyPathsInSvelte(source: string): { path: string[]; line: number }[] {
  return readSvelte(source)
    .code.flatMap((c) =>
      copyPaths(c.text).map((p) => ({ path: p.path, line: lineAt(source, c.at + p.at) })),
    )
    .sort((a, b) => a.line - b.line)
}

/** A component's hardcoded markup words, and its code: the scripts and every expression. */
function readSvelte(source: string): { markup: Found[]; code: Code[] } {
  const ast = parse(source, { modern: true })
  const markup: Found[] = []
  const code: Code[] = []
  const add = (text: string, at: number) => markup.push({ text, line: lineAt(source, at) })

  // An expression is parsed in parentheses, so `{ a: 1 }` is an object, not a block.
  const expression = (node: Node) =>
    code.push({ text: `(${source.slice(node.start, node.end)})`, at: node.start - 1 })

  const walk = (value: unknown, inFragment = false): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, inFragment)
      return
    }
    if (!isNode(value)) return
    if (!TEMPLATE.has(value.type)) {
      expression(value)
    } else if (value.type === 'Text') {
      if (inFragment && /\p{L}/u.test(value.data as string)) {
        add((value.data as string).trim().replace(/\s+/g, ' '), value.start + leading(value))
      }
    } else if (value.type === 'Fragment') {
      walk(value.nodes, true)
    } else if (value.type === 'Attribute') {
      attribute(value)
    } else if (value.type !== 'Comment') {
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'metadata') walk(child)
      }
    }
  }

  const attribute = (node: Node) => {
    if (!Array.isArray(node.value)) {
      walk(node.value)
      return
    }
    const parts = node.value as Node[]
    const name = node.name as string
    const text = parts
      .filter((p) => p.type === 'Text')
      .map((p) => p.data as string)
      .join('')
      .trim()
    if (SPOKEN.has(name.toLowerCase()) && /\p{L}/u.test(text)) add(`${name}="${text}"`, node.start)
    for (const part of parts) if (part.type !== 'Text') walk(part)
  }

  for (const script of [ast.module, ast.instance]) {
    if (!script) continue
    const { start, end } = script.content as unknown as Node
    code.push({ text: source.slice(start, end), at: start })
  }
  walk(ast.fragment)
  return { markup, code }
}

const leading = (text: Node) => (text.data as string).search(/\S/)

/** Words in the string literals of a `.ts` file. */
export function wordsInTs(source: string): Found[] {
  return literalWords(source).map((w) => ({ text: w.text, line: lineAt(source, w.at) }))
}

const parseTs = (code: string) =>
  ts.createSourceFile('code.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

/** Each `copy.a.b` chain, whole: its property names, and where it starts. */
function copyPaths(code: string): { path: string[]; at: number }[] {
  const file = parseTs(code)
  const found: { path: string[]; at: number }[] = []

  const visit = (node: ts.Node): void => {
    // Only the outermost access of a chain: `copy.a` inside `copy.a.b` is the same read.
    const { parent } = node as { parent?: ts.Node } // undefined on the file itself
    const inner = parent && ts.isPropertyAccessExpression(parent) && parent.expression === node
    if (ts.isPropertyAccessExpression(node) && !inner) {
      const path: string[] = []
      let on: ts.Expression = node
      while (ts.isPropertyAccessExpression(on)) {
        path.unshift(on.name.text)
        on = on.expression
      }
      if (ts.isIdentifier(on) && on.text === 'copy') found.push({ path, at: node.getStart(file) })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Each string literal that reads as words, and where it starts, skipping developers' words. */
function literalWords(code: string): { text: string; at: number }[] {
  const file = parseTs(code)
  const found: { text: string; at: number }[] = []

  const visit = (node: ts.Node): void => {
    if (isForDevelopers(node)) return
    if (isLiteral(node) && !isName(node) && isWords(node.text)) {
      found.push({ text: node.text.trim(), at: node.getStart(file) })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

type Literal =
  | ts.StringLiteral
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail

const isLiteral = (node: ts.Node): node is Literal =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node)

/** A string that names something rather than saying it: a module, a type, a key. */
function isName(node: Literal): boolean {
  const { parent } = node
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isModuleDeclaration(parent) ||
    ts.isLiteralTypeNode(parent) ||
    ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node) ||
    (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword)
  )
}

/** SQL calls and the tagged `sql` template. */
const SQL_CALLS = new Set(['exec', 'pragma', 'prepare'])

/** An error's message, a log line, or SQL: words for a developer or a database. */
function isForDevelopers(node: ts.Node): boolean {
  if (ts.isNewExpression(node)) {
    return ts.isIdentifier(node.expression) && node.expression.text.endsWith('Error')
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return ts.isIdentifier(node.tag) && node.tag.text === 'sql'
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const { expression: on, name } = node.expression
    return (
      (ts.isIdentifier(on) && (on.text === 'console' || on.text === 'log')) ||
      SQL_CALLS.has(name.text)
    )
  }
  return false
}
