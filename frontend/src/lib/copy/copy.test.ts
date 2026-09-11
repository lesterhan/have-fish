/**
 * Keeps converted surfaces converted.
 *
 * Extraction is per-surface and spread over many PRs, which means there is a long window
 * in which half the app reads from `copy/` and half does not. Without a check, surface
 * six regresses while surface seven is being written — not through malice but because a
 * new button in a converted file is one hardcoded label, and nothing objects.
 *
 * So this mirrors the arrangement `tokens.css` and `tokens.test.ts` already use: one file
 * is the single source of truth for a category of values, and a test asserts against the
 * *source* of everything else to stop that category leaking back out. `CONVERTED` below
 * is the list of surfaces under that contract; each extraction story appends to it, and
 * the entry is the story's actual deliverable.
 *
 * Two detectors, because copy hides in two places:
 *
 * - **Markup** — text nodes, and the handful of attributes that render as words
 *   (`placeholder`, `title`, `aria-label`, …). Everything a component interpolates is a
 *   mustache, so anything left over with a letter in it is a literal someone typed.
 * - **Script** — prose string literals. This one cannot be exact: `'2-digit'` and
 *   `'application/json'` are strings too. The heuristic is "two or more words", which
 *   catches `'Passwords do not match'` and ignores every option constant in the codebase.
 *   It will miss a single-word label. That is accepted: a detector that fires on `'POST'`
 *   would be turned off within a week, and the markup detector is the strict one.
 *
 * Exceptions go in `ALLOWED` as file+text pairs rather than whole-file exemptions, so an
 * exemption covers the one string it was argued for and not everything added afterwards.
 * Unused entries fail the test, which is the only thing that stops the list becoming a
 * graveyard.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { svelteFilesUnder } from '../../testing/source-scan'

/** `frontend/src`, from `frontend/src/lib/copy`. */
const SRC = join(import.meta.dir, '..', '..')

/**
 * Surfaces that have been extracted, as paths under `src/`. A directory covers every
 * `.svelte` file beneath it. Append here as part of the story that converts the surface —
 * an extraction PR that does not extend this list has not actually finished.
 */
const CONVERTED = [
  'routes/login/+page.svelte',
  'routes/signup/+page.svelte',
  // The case, per DESIGN.md §2: the shell and the furniture, story 3.
  'routes/+layout.svelte',
  'lib/components/Sidebar.svelte',
  'lib/components/AccentPicker.svelte',
  'lib/components/ui',
]

/**
 * Strings a converted file is allowed to keep, with the reason. Keep these rare: almost
 * every candidate is really a string that belongs in a copy file.
 */
const ALLOWED: Array<{ file: string; text: string; why: string }> = []

// --- finding the files ----------------------------------------------------------------

function convertedFiles(): string[] {
  const out: string[] = []
  for (const entry of CONVERTED) {
    const full = join(SRC, entry)
    const stat = statSync(full) // throws if a story removed a file without updating the list
    if (stat.isDirectory()) out.push(...svelteFilesUnder(full))
    else out.push(full)
  }
  return out.sort()
}

// --- reading a .svelte file -----------------------------------------------------------

/**
 * Attributes whose literal value reaches the user's eyes or their screen reader.
 * `name`, `for`, `type`, `href` and friends are deliberately absent — they are wiring.
 */
const USER_FACING_ATTRS = new Set([
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

/** `<script>` and `<style>` bodies, and HTML comments — handled separately or not at all. */
function stripBlocks(source: string): string {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

/** The `<script>` bodies, joined, with comments removed. */
function scriptBodies(source: string): string {
  return stripComments(
    [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1])
      .join('\n'),
  )
}

/**
 * Blanks out `//` and block comments, leaving newlines so line numbers survive.
 *
 * Not cosmetic: this codebase explains itself in prose, and that prose quotes phrases —
 * `// the "see everything" escape hatch`. Left in, those read as copy and every converted
 * file arrives with a handful of exemptions for sentences nobody will ever see.
 * Quoted strings are stepped over so a `//` inside a URL does not eat the rest of a line.
 */
function stripComments(js: string): string {
  let out = ''
  for (let i = 0; i < js.length; i++) {
    const c = js[i]

    if (c === '"' || c === "'" || c === '`') {
      const end = skipQuoted(js, i)
      out += js.slice(i, end + 1)
      i = end
      continue
    }

    if (c === '/' && js[i + 1] === '/') {
      while (i < js.length && js[i] !== '\n') i++
      out += '\n'
      continue
    }

    if (c === '/' && js[i + 1] === '*') {
      const end = js.indexOf('*/', i + 2)
      const body = js.slice(i, end === -1 ? js.length : end + 2)
      out += body.replace(/[^\n]/g, '')
      i = end === -1 ? js.length : end + 1
      continue
    }

    out += c
  }
  return out
}

/**
 * Index just past the `{…}` starting at `from`, skipping nested braces and quoted
 * strings. Svelte's blocks (`{#if}`, `{:else}`, `{@render}`) and every interpolation go
 * through here, which is why the text scanner never sees an expression.
 */
function skipMustache(source: string, from: number): number {
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(source, i)
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return source.length
}

/** Index of the closing quote of the string opening at `from`. */
function skipQuoted(source: string, from: number): number {
  const quote = source[from]
  for (let i = from + 1; i < source.length; i++) {
    if (source[i] === '\\') i++
    else if (source[i] === quote) return i
  }
  return source.length
}

/** HTML entities are punctuation and spacing, not words — `&nbsp;` is not a copy edit. */
const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g

function hasWords(text: string): boolean {
  return /[A-Za-z]/.test(text.replace(ENTITY, ''))
}

/**
 * Does this string literal, found inside a `{…}`, look like something a user reads?
 *
 * Markup expressions are full of strings that are not copy — class names, icon names, route
 * paths, currency codes, `'2-digit'`. But they are also where a lot of real copy hides:
 * `use:tooltip={'Accounts'}`, `aria-label={open ? 'Compress sidebar' : 'Expand sidebar'}`,
 * `{theme.dark ? 'Light Theme' : 'Dark Theme'}`. Skipping every mustache, as the first
 * version of this file did, made the check blind to every tooltip in the app.
 *
 * The signature of a label is sentence case or more than one word. Lowercase single words
 * (`'active'`, `'sun'`, `'moon'`) are wiring; SHOUTED ones (`'CAD'`, `'USD'`) are codes;
 * anything with a slash or a `$` is a path or a built string.
 */
function looksLikeLabel(value: string): boolean {
  const text = value.trim()
  if (text.length < 2) return false
  if (/[/$<>{}[\]]/.test(text)) return false // a path, a built string, a CSS selector
  if (KEY_NAMES.has(text)) return false
  if (!/[a-z]/.test(text)) return false // all caps, or no letters at all: a code
  return /^[A-Z]/.test(text) || /[A-Za-z]\s+[A-Za-z]/.test(text)
}

/**
 * `KeyboardEvent.key` values, which are capitalised words that are not words.
 *
 * `e.key === 'Enter'` reads exactly like a label and appears in markup handlers all over
 * the app. Excluding them by name is narrower than excluding every capitalised string, and
 * unlike an allowlist entry it does not have to be re-argued in each new file. The key
 * legends the app prints — "Ctrl K", "Esc" — are different strings and stay copy.
 */
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

/** Label-shaped string literals inside one `{…}` expression, quotes included. */
function mustacheLabels(mustache: string): string[] {
  const found: string[] = []
  for (const [whole, single, double] of mustache.matchAll(
    /'([^'\\]*)'|"([^"\\]*)"/g,
  )) {
    const value = single ?? double
    if (value !== undefined && looksLikeLabel(value)) found.push(whole)
  }
  return found
}

/**
 * Every hardcoded user-facing string in the markup of one `.svelte` source.
 *
 * The scanner alternates between text and tag: inside a tag it only reports quoted values
 * of user-facing attributes, outside one it reports any text left after the mustaches are
 * skipped.
 */
export function markupStrings(source: string): string[] {
  const markup = stripBlocks(source)
  const found: string[] = []
  let i = 0
  let text = ''

  const flushText = () => {
    const trimmed = text.trim()
    if (trimmed && hasWords(trimmed)) found.push(trimmed.replace(/\s+/g, ' '))
    text = ''
  }

  while (i < markup.length) {
    const c = markup[i]

    if (c === '{') {
      const end = skipMustache(markup, i)
      found.push(...mustacheLabels(markup.slice(i, end)))
      i = end
      // An interpolation splits a text node without joining the words either side of it.
      flushText()
      continue
    }

    if (c === '<') {
      flushText()
      i = scanTag(markup, i, found)
      continue
    }

    text += c
    i++
  }

  flushText()
  return found
}

/** Scans one `<tag …>`, pushing offending attribute values. Returns the index past it. */
function scanTag(markup: string, from: number, found: string[]): number {
  let i = from + 1
  while (i < markup.length && markup[i] !== '>') {
    if (markup[i] === '{') {
      const end = skipMustache(markup, i) // a spread, or an attribute's expression
      found.push(...mustacheLabels(markup.slice(i, end)))
      i = end
      continue
    }

    const attr = /^([A-Za-z_@:][\w:.-]*)\s*=\s*(["'])/.exec(markup.slice(i))
    if (!attr) {
      i++
      continue
    }

    const [, name, quote] = attr
    const valueStart = i + attr[0].length
    const valueEnd = markup.indexOf(quote, valueStart)
    if (valueEnd === -1) return markup.length

    if (USER_FACING_ATTRS.has(name.toLowerCase())) {
      // Strip interpolations first: `title="{label}"` is clean, `title="Total {n}"` is not.
      const value = markup
        .slice(valueStart, valueEnd)
        .replace(/\{[^{}]*\}/g, '')
        .trim()
      if (value && hasWords(value)) found.push(`${name}="${value}"`)
    }

    i = valueEnd + 1
  }
  return Math.min(i + 1, markup.length)
}

/**
 * Prose-looking string literals in the `<script>` block.
 *
 * "Prose" is two or more letter-words separated by a space, with no `/` (paths, MIME
 * types, URLs) and no `$` (a template literal doing interpolation is usually building a
 * class list or a URL). Lines mentioning `console.` or `new Error(` are skipped outright:
 * those strings are addressed to a developer, and demanding they be extracted would make
 * the check worth ignoring.
 */
export function scriptStrings(source: string): string[] {
  const found: string[] = []
  for (const line of scriptBodies(source).split('\n')) {
    if (line.includes('console.') || line.includes('new Error(')) continue
    for (const [, single, double] of line.matchAll(
      /'([^'\\]*)'|"([^"\\]*)"/g,
    )) {
      const value = single ?? double
      if (value !== undefined && isProse(value)) {
        found.push(single !== undefined ? `'${value}'` : `"${value}"`)
      }
    }
  }
  return found
}

function isProse(value: string): boolean {
  if (/[/$[\]]/.test(value)) return false
  const words = value.match(/[A-Za-z]{2,}/g)
  return words !== null && words.length >= 2 && / /.test(value.trim())
}

// --- the check ------------------------------------------------------------------------

describe('extracted surfaces stay extracted', () => {
  const hits = new Map<string, string[]>()
  for (const file of convertedFiles()) {
    const rel = relative(SRC, file)
    const source = readFileSync(file, 'utf8')
    const strings = [...markupStrings(source), ...scriptStrings(source)]
    if (strings.length) hits.set(rel, strings)
  }

  const allowed = new Set(ALLOWED.map((a) => `${a.file}\u0000${a.text}`))
  const used = new Set<string>()
  const offenders: string[] = []
  for (const [file, strings] of hits) {
    for (const text of strings) {
      const key = `${file}\u0000${text}`
      if (allowed.has(key)) used.add(key)
      else offenders.push(`${file}: ${text}`)
    }
  }

  it('holds no user-facing string outside src/lib/copy', () => {
    expect(
      offenders,
      offenders.length
        ? `Move these into src/lib/copy, or add them to ALLOWED with a reason:\n  ${offenders.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('carries no stale entry in ALLOWED', () => {
    const stale = ALLOWED.filter(
      (a) => !used.has(`${a.file}\u0000${a.text}`),
    ).map((a) => `${a.file}: ${a.text}`)

    expect(
      stale,
      stale.length
        ? `These no longer appear in the file they exempt — delete them:\n  ${stale.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('covers every surface it claims to', () => {
    // A directory that has become empty, or a path typo, would otherwise make this
    // whole suite pass by checking nothing.
    expect(convertedFiles().length).toBeGreaterThanOrEqual(CONVERTED.length)
  })
})

// --- the splice, everywhere ------------------------------------------------------------

/**
 * A ternary that inflects a word from outside it.
 *
 * ```
 * `${n} transaction${n === 1 ? '' : 's'} imported`
 * ```
 *
 * This one is not scoped to `CONVERTED`, because it is not about where copy lives. The
 * splice is unfixable in principle rather than untidy: Polish needs three plural forms and
 * Chinese needs none, and no message format can express "append an s to the middle of my
 * sentence." Every other rule in this epic is a preference that a second locale would make
 * expensive; this one a second locale cannot satisfy at all. So it is banned repo-wide from
 * the day the last one was removed, which is cheaper than removing them twice.
 *
 * The signature is narrow on purpose: both branches string literals, and at least one of
 * them either empty or a bare inflectional ending. A ternary between two whole words
 * (`'entry' : 'entries'`) is not matched — that is a value and its unit in a table cell as
 * often as it is prose, and the surface stories judge those case by case.
 */
const SPLICE =
  /\?\s*(?:'([^'\\]*)'|"([^"\\]*)")\s*:\s*(?:'([^'\\]*)'|"([^"\\]*)")/g

/** The endings English glues on. Empty counts: it is the other half of every `'' : 's'`. */
const INFLECTION = new Set(['', 's', 'es', 'y', 'ies', "'s", 'en'])

export function spliceTernaries(source: string): string[] {
  SPLICE.lastIndex = 0
  const found: string[] = []
  for (const m of source.matchAll(SPLICE)) {
    const left = m[1] ?? m[2]
    const right = m[3] ?? m[4]
    if (left === undefined || right === undefined) continue
    if (INFLECTION.has(left) && INFLECTION.has(right)) {
      found.push(m[0].replace(/\s+/g, ' '))
    }
  }
  return found
}

describe('the plural splice', () => {
  it('appears nowhere in the app', () => {
    const offenders: string[] = []
    for (const file of svelteFilesUnder(SRC)) {
      for (const hit of spliceTernaries(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(SRC, file)}: ${hit}`)
      }
    }

    expect(
      offenders,
      offenders.length
        ? `Use plural(n, one, other) so both readings are whole sentences:\n  ${offenders.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('catches the shapes it is meant to catch', () => {
    expect(spliceTernaries("`${n} row${n === 1 ? '' : 's'}`")).toHaveLength(1)
    expect(spliceTernaries("{n === 1 ? 's' : ''}")).toHaveLength(1)
    expect(spliceTernaries("currenc{n === 1 ? 'y' : 'ies'}")).toHaveLength(1)
    expect(spliceTernaries('{n === 1 ? "" : "s"}')).toHaveLength(1)
  })

  it('leaves whole words and real messages alone', () => {
    expect(spliceTernaries("{n === 1 ? 'entry' : 'entries'}")).toEqual([])
    expect(spliceTernaries("plural(n, '1 row', `${n} rows`)")).toEqual([])
    expect(spliceTernaries("{open ? 'Hide' : 'Show'}")).toEqual([])
    expect(spliceTernaries("{ok ? '' : 'error'}")).toEqual([])
    expect(spliceTernaries("class={active ? 'on' : ''}")).toEqual([])
  })
})

// --- the detectors, checked against themselves ----------------------------------------
//
// A detector that silently stopped matching would pass the check above by finding nothing
// at all, so the shapes it is meant to catch are pinned here.

describe('markupStrings', () => {
  it('catches text nodes', () => {
    expect(markupStrings('<span>Sign in</span>')).toEqual(['Sign in'])
    expect(markupStrings('<p>\n  Passwords do not match\n</p>')).toEqual([
      'Passwords do not match',
    ])
  })

  it('catches user-facing attributes', () => {
    expect(markupStrings('<input placeholder="Your name" />')).toEqual([
      'placeholder="Your name"',
    ])
    expect(markupStrings('<button aria-label="Close panel" />')).toEqual([
      'aria-label="Close panel"',
    ])
    expect(markupStrings('<input title="Total {n}" />')).toEqual([
      'title="Total"',
    ])
  })

  it('leaves wiring attributes alone', () => {
    expect(markupStrings('<label for="email" />')).toEqual([])
    expect(markupStrings('<Icon name="lock" />')).toEqual([])
    expect(markupStrings('<a href="/signup" class="switch-link" />')).toEqual(
      [],
    )
    expect(
      markupStrings(
        '<TextInput type="password" autocomplete="new-password" />',
      ),
    ).toEqual([])
  })

  it('catches labels hiding inside expressions', () => {
    expect(markupStrings("<a use:tooltip={'Accounts'} />")).toEqual([
      "'Accounts'",
    ])
    expect(
      markupStrings("<span>{dark ? 'Light Theme' : 'Dark Theme'}</span>"),
    ).toEqual(["'Light Theme'", "'Dark Theme'"])
    expect(
      markupStrings(
        "<button aria-label={open ? 'Compress sidebar' : 'Expand sidebar'} />",
      ),
    ).toEqual(["'Compress sidebar'", "'Expand sidebar'"])
  })

  it('leaves the expressions that are wiring alone', () => {
    expect(
      markupStrings("<input onkeydown={(e) => e.key === 'Enter' && go()} />"),
    ).toEqual([])
    expect(markupStrings("<div class={active ? 'on' : 'off'} />")).toEqual([])
    expect(markupStrings("<Icon name={dark ? 'sun' : 'moon'} />")).toEqual([])
    expect(markupStrings("<a class:active={path === '/accounts'} />")).toEqual(
      [],
    )
    expect(markupStrings("<CurrencyPill code={'CAD'} />")).toEqual([])
    expect(markupStrings("{#if unit === 'USD'}<b>{unit}</b>{/if}")).toEqual([])
    expect(
      markupStrings(
        "<time>{d.toLocaleDateString(l, { day: '2-digit' })}</time>",
      ),
    ).toEqual([])
  })

  it('leaves interpolated copy alone', () => {
    expect(markupStrings('<span>{copy.auth.signIn.title}</span>')).toEqual([])
    expect(
      markupStrings('<input placeholder={copy.auth.signUp.nameHint} />'),
    ).toEqual([])
    expect(markupStrings('<input placeholder="{label}" />')).toEqual([])
  })

  it('sees through Svelte blocks', () => {
    expect(markupStrings('{#if error}<p>{error}</p>{/if}')).toEqual([])
    expect(
      markupStrings('{#each rows as row}<td>{row.name}</td>{/each}'),
    ).toEqual([])
    expect(markupStrings("{#if n > 1}{'a'}{:else}{'b'}{/if}")).toEqual([])
    expect(markupStrings('{@render children?.()}')).toEqual([])
  })

  it('does not join the words either side of an interpolation', () => {
    // `{a} of {b}` must not read as the single text node "of" plus nothing — and must
    // certainly not read as one string spanning the expression.
    expect(markupStrings('<p>{shown} of {total}</p>')).toEqual(['of'])
  })

  it('ignores script and style bodies, comments, and entities', () => {
    expect(markupStrings("<script>let x = 'hello there'</script>")).toEqual([])
    expect(markupStrings('<style>.a { content: "x y"; }</style>')).toEqual([])
    expect(markupStrings('<!-- a note to the reader -->')).toEqual([])
    expect(markupStrings('<span>&nbsp;</span>')).toEqual([])
    expect(markupStrings('<span>&mdash;</span>')).toEqual([])
  })
})

describe('scriptStrings', () => {
  it('catches prose', () => {
    expect(scriptStrings("<script>error = 'Sign in failed'</script>")).toEqual([
      "'Sign in failed'",
    ])
    expect(
      scriptStrings('<script>const m = "Passwords do not match"</script>'),
    ).toEqual(['"Passwords do not match"'])
  })

  it('leaves the strings that are not copy alone', () => {
    expect(
      scriptStrings("<script>import { copy } from '$lib/copy'</script>"),
    ).toEqual([])
    expect(
      scriptStrings(
        "<script>fetch('/api/accounts', { method: 'POST' })</script>",
      ),
    ).toEqual([])
    expect(
      scriptStrings("<script>const f = { month: '2-digit' }</script>"),
    ).toEqual([])
    expect(
      scriptStrings("<script>el.setAttribute('data-theme', 'dark')</script>"),
    ).toEqual([])
    expect(
      scriptStrings(
        `<script>const F = 'a[href], button:not([disabled]), [tabindex]'</script>`,
      ),
    ).toEqual([])
    expect(
      scriptStrings(
        "<script>console.warn('could not load the thing')</script>",
      ),
    ).toEqual([])
    expect(
      scriptStrings(
        "<script>throw new Error('this should never happen')</script>",
      ),
    ).toEqual([])
  })

  it('does not read the markup', () => {
    expect(scriptStrings('<p>Passwords do not match</p>')).toEqual([])
  })

  it('does not read the comments', () => {
    expect(
      scriptStrings('<script>// the "see everything" escape hatch\n</script>'),
    ).toEqual([])
    expect(
      scriptStrings('<script>/* a note\n   about "going deeper" */\n</script>'),
    ).toEqual([])
    // A `//` inside a string must not swallow the rest of the line.
    expect(
      scriptStrings(
        `<script>const u = 'https://x'; const m = 'Sign in failed'</script>`,
      ),
    ).toEqual(["'Sign in failed'"])
  })
})
