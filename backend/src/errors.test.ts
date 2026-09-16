/**
 * Keeps the backend out of the copywriting business.
 *
 * The 294 hand-typed `error: '…'` strings this story replaced did not arrive in one commit;
 * they accumulated one route at a time, each one obviously fine on its own. Nothing stopped
 * them, so the same failure ended up with four spellings and one of them told the reader
 * which settings tab to open. The registry only holds if adding a sentence back is a test
 * failure rather than a code review someone might not do.
 *
 * Modelled on the frontend's `copy.test.ts` and `tokens.test.ts`: one file is the single
 * source of truth for a category of values, and a test reads the *source* of everything
 * else to stop the category leaking back out.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ERROR_STATUS } from './errors'

const SRC = import.meta.dir
const SELF = 'errors.test.ts'
const REGISTRY = 'errors.ts'

/** Statuses a failure is allowed to answer with. Anything else is a typo or a new idea. */
const STATUSES = new Set([400, 401, 403, 404, 409, 422])

function tsFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Every `.ts` file the rule applies to: not this test, not the registry it guards. */
function scannedFiles(): string[] {
  return tsFilesUnder(SRC)
    .filter((f) => {
      const name = f.slice(f.lastIndexOf('/') + 1)
      return name !== SELF && name !== REGISTRY && !name.endsWith('.test.ts')
    })
    .sort()
}

/**
 * `//` and block comments, blanked out.
 *
 * Not cosmetic: this codebase explains itself in prose and that prose quotes the very thing
 * being banned — the registry's own header shows `{ error: 'FIELD_REQUIRED' }`. A regex that
 * only catches comments at the start of a line would also flag a trailing one, so this steps
 * over quoted strings the way the frontend's copy check does, and a `//` inside a URL does
 * not eat the rest of its line.
 */
function stripComments(ts: string): string {
  let out = ''
  for (let i = 0; i < ts.length; i++) {
    const c = ts[i]!

    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let end = ts.length
      for (let j = i + 1; j < ts.length; j++) {
        if (ts[j] === '\\') j++
        else if (ts[j] === quote) { end = j; break }
      }
      out += ts.slice(i, end + 1)
      i = end
      continue
    }

    if (c === '/' && ts[i + 1] === '/') {
      while (i < ts.length && ts[i] !== '\n') i++
      out += '\n'
      continue
    }

    if (c === '/' && ts[i + 1] === '*') {
      const end = ts.indexOf('*/', i + 2)
      out += ts.slice(i, end === -1 ? ts.length : end + 2).replace(/[^\n]/g, '')
      i = end === -1 ? ts.length : end + 1
      continue
    }

    out += c
  }
  return out
}

/**
 * An `error:` property whose value is written out rather than named.
 *
 * Narrow on purpose: `error: someVariable` and `error: code` are how a value reaches the
 * body legitimately. It is the quoted literal — in any of the three quote styles, because
 * the first inventory of these missed every double-quoted and templated one — that means
 * somebody wrote a sentence.
 */
const WRITTEN_ERROR = /\berror:\s*(?:'[^'\\]*'|"[^"\\]*"|`[^`\\]*`)/g

export function writtenErrorsIn(source: string): string[] {
  WRITTEN_ERROR.lastIndex = 0
  return [...stripComments(source).matchAll(WRITTEN_ERROR)].map((m) =>
    m[0].replace(/\s+/g, ' '),
  )
}

describe('the routes write no sentences', () => {
  it('scans the files it means to', () => {
    // A moved directory would otherwise make this pass by reading nothing.
    expect(scannedFiles().length).toBeGreaterThan(20)
  })

  it('holds no error text outside src/errors.ts', () => {
    const offenders: string[] = []
    for (const file of scannedFiles()) {
      for (const hit of writtenErrorsIn(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(SRC, file)}: ${hit}`)
      }
    }

    expect(
      offenders,
      offenders.length
        ? `Add a code to src/errors.ts and its words to frontend/src/lib/copy/errors.ts:\n  ${offenders.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('catches the shapes it is meant to catch', () => {
    expect(writtenErrorsIn("c.json({ error: 'not found' }, 404)")).toHaveLength(1)
    expect(writtenErrorsIn('c.json({ error: "not found" }, 404)')).toHaveLength(1)
    expect(writtenErrorsIn('c.json({ error: `no ${x}` }, 404)')).toHaveLength(1)
  })

  it('leaves a named value alone', () => {
    expect(writtenErrorsIn('return c.json({ error: code }, status)')).toEqual([])
    expect(writtenErrorsIn("// an example: { error: 'x' }")).toEqual([])
    expect(writtenErrorsIn("const u = 'http://x'\nc.json({ error: code })")).toEqual([])
  })
})

describe('the registry', () => {
  it('answers with a status somebody meant', () => {
    const odd = Object.entries(ERROR_STATUS).filter(([, s]) => !STATUSES.has(s))
    expect(odd).toEqual([])
  })

  it('declares nothing no route can produce', () => {
    // A code with no call site is a sentence in copy/errors.ts that nobody will ever read,
    // and the frontend's own check cannot see that — it only knows the code is declared.
    const source = scannedFiles()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    const used = new Set([...source.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]!))
    const dead = Object.keys(ERROR_STATUS).filter((code) => !used.has(code))

    expect(
      dead,
      dead.length
        ? `No route fails this way any more — delete the code and its words:\n  ${dead.join('\n  ')}`
        : '',
    ).toEqual([])
  })
})
