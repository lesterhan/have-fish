// Every word the app shows is in `copy/`. This reads every component and module of the app
// and fails on a word typed anywhere else; `tools/words.ts` says what counts.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { copyPathsInSvelte, type Found, wordsInSvelte, wordsInTs } from '../tools/words'
import { copy } from '.'

const DESKTOP = join(import.meta.dirname, '..')

/** The app's code: both processes, the bridge, and the contract between them. */
const READ = ['main', 'preload', 'renderer', 'shared']

/** Files that aren't read, each with why. */
const SKIPPED: Record<string, string> = {
  'main/db/migrations.ts': 'generated: the SQL of each migration',
  'main/ledger/fixtures.ts': 'test data, imported only by tests',
  'main/ledger/arbitrary.ts': 'test data, imported only by tests',
}

const POLICY = 'a content security policy directive, read by the browser'

/** Words a file may keep, each with why. Keep it short: nearly every candidate is copy. */
const ALLOWED: { file: string; text: string; why: string }[] = [
  { file: 'main/protocol.ts', text: "default-src 'self'", why: POLICY },
  { file: 'main/protocol.ts', text: "object-src 'none'", why: POLICY },
  { file: 'main/protocol.ts', text: "base-uri 'none'", why: POLICY },
  { file: 'main/protocol.ts', text: "form-action 'none'", why: POLICY },
  { file: 'main/protocol.ts', text: "frame-ancestors 'none'", why: POLICY },
]

const appFiles = () =>
  READ.flatMap((dir) =>
    readdirSync(join(DESKTOP, dir), { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f)),
  )
    .filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f) && !(f in SKIPPED))
    .sort()

function wordsIn(file: string): Found[] {
  const source = readFileSync(join(DESKTOP, file), 'utf8')
  return file.endsWith('.svelte') ? wordsInSvelte(source) : wordsInTs(source)
}

const found = appFiles().flatMap((file) => wordsIn(file).map((w) => ({ file, ...w })))
const allowed = (f: { file: string; text: string }) =>
  ALLOWED.some((a) => a.file === f.file && a.text === f.text)

describe('every word is in copy/', () => {
  test('it read the app', () => {
    const files = appFiles()
    expect(files.filter((f) => f.endsWith('.svelte')).length).toBeGreaterThan(3)
    expect(files.length).toBeGreaterThan(30)
  })

  test('no file outside copy/ has words of its own', () => {
    const typed = found.filter((f) => !allowed(f)).map((f) => `${f.file}:${f.line} ${f.text}`)
    expect(typed, 'Move these into copy/ and read them from `copy`').toEqual([])
  })

  test('every allowed word is still there', () => {
    const unused = ALLOWED.filter((a) => !found.some((f) => f.file === a.file && f.text === a.text))
    expect(unused).toEqual([])
  })

  test('every skipped file is still there', () => {
    expect(Object.keys(SKIPPED).filter((f) => !existsSync(join(DESKTOP, f)))).toEqual([])
  })
})

// tsc checks the paths in `.ts` files. Nothing checks `.svelte` files, where a mistyped key
// renders nothing; this does.
describe('every copy key a component reads exists', () => {
  /** The value at `path` in `copy`, or undefined. Only its own keys, so `toString` isn't one. */
  function at(path: string[]): unknown {
    let value: unknown = copy
    for (const key of path) {
      if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return
      value = (value as Record<string, unknown>)[key]
    }
    return value
  }

  const components = appFiles().filter((f) => f.endsWith('.svelte'))
  const read = components.flatMap((file) =>
    copyPathsInSvelte(readFileSync(join(DESKTOP, file), 'utf8')).map((p) => ({ file, ...p })),
  )

  test('it read them', () => {
    expect(read.length).toBeGreaterThan(10)
  })

  test('every one is in copy', () => {
    const missing = read
      .filter((r) => at(r.path) === undefined)
      .map((r) => `${r.file}:${r.line} copy.${r.path.join('.')}`)
    expect(missing, 'No such key in copy/').toEqual([])
  })
})
