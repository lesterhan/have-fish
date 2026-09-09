import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sourceFilesUnder } from '../testing/source-scan'

/**
 * Guards the one import rule that CI enforces and a local run cannot.
 *
 * `bun test` resolves path aliases from tsconfig.json, and ours only gets `$lib` by
 * extending `.svelte-kit/tsconfig.json` — which SvelteKit generates and .gitignore
 * excludes. So a *value* import through `$lib` in a .ts module resolves on a developer
 * machine, where an earlier `bun run check` left .svelte-kit behind, and fails on CI's
 * clean checkout with "Cannot find module '$lib/…'". A green local run and a red pipeline
 * is the worst shape a failure can take, which is why this is worth a test.
 *
 * Restating the aliases in tsconfig.json is not the fix: SvelteKit warns that doing so
 * interferes with its generated config and points at `kit.alias`, which only feeds that
 * same generated file and so does not help bun either.
 *
 * Type-only imports are exempt — TypeScript erases them before bun resolves anything,
 * which is why `import type { Account } from '$lib/api'` is all over these modules and
 * has never broken. Type-position `import('$lib/x').Thing` expressions are erased too.
 *
 * .svelte files are unaffected: Vite resolves their aliases and bun never loads them. So are
 * SvelteKit's own route modules — `+page.ts`, `+layout.server.ts`, `+server.ts`, `hooks.*.ts`
 * — for the same reason and by the same test: nothing bun runs ever imports them.
 *
 * This scans every other .ts file under src/. It used to scan only src/lib, and the first
 * import to break CI after it was written was in src/styles: the rule was never about which
 * directory a file lives in, only about who resolves the import.
 */

const SRC_DIR = join(import.meta.dir, '..')

/** Loaded by Vite, never by bun — the same exemption `.svelte` files get. */
const VITE_LOADED = /^(\+(page|layout|server)[\w.]*|hooks(\.\w+)?|app\.d)\.ts$/
const SELF = 'lib-imports.test.ts'

/** Every .ts file the rule applies to: not this test, not the modules Vite loads. */
function scannedFiles(): string[] {
  return sourceFilesUnder(SRC_DIR, ['.ts']).filter((full) => {
    const name = full.slice(full.lastIndexOf('/') + 1)
    return name !== SELF && !VITE_LOADED.test(name)
  })
}

/**
 * One `import`/`export … from '$lib…'` statement that is not `import type`.
 *
 * The body may span lines but may not cross a `from` or a `;`, so the match cannot start
 * at one statement and reach a later statement's specifier — which is exactly how the
 * first draft of this regex reported fourteen phantom offenders.
 */
const VALUE_IMPORT =
  /^[ \t]*(?:import|export)\b(?![ \t]+type\b)(?:(?!\bfrom\b|;)[\s\S])*?\bfrom\s*['"]\$lib(?:\/|['"])/gm

function offendersIn(source: string): string[] {
  VALUE_IMPORT.lastIndex = 0
  return [...source.matchAll(VALUE_IMPORT)].map((m) =>
    m[0].trim().replace(/\s+/g, ' '),
  )
}

describe('$lib imports in testable modules', () => {
  it('never value-imports through $lib — CI has no .svelte-kit to resolve it', () => {
    const offenders: string[] = []
    for (const file of scannedFiles()) {
      const rel = file.slice(file.indexOf('src/'))
      for (const hit of offendersIn(readFileSync(file, 'utf8'))) {
        offenders.push(`${rel}: ${hit}`)
      }
    }

    expect(
      offenders,
      offenders.length
        ? `Use a relative path, or "import type" if only types are needed:\n  ${offenders.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('catches the shapes it is meant to catch', () => {
    // A regex that silently stops matching would otherwise pass the check above by
    // finding nothing at all.
    expect(offendersIn(`import { MONTH_NAMES } from '$lib/date'`)).toHaveLength(
      1,
    )
    expect(offendersIn(`import def from "$lib/api"`)).toHaveLength(1)
    expect(offendersIn(`export { thing } from '$lib/util'`)).toHaveLength(1)
    expect(offendersIn(`import {\n  a,\n  b,\n} from '$lib/api'`)).toHaveLength(
      1,
    )
  })

  it('leaves the erased forms alone', () => {
    expect(offendersIn(`import type { Account } from '$lib/api'`)).toEqual([])
    expect(offendersIn(`export type { Account } from '$lib/api'`)).toEqual([])
    expect(offendersIn(`import { MONTH_NAMES } from '../../date'`)).toEqual([])
    // A type-position dynamic import, as in api.ts's UserPreferences.
    expect(
      offendersIn(`  accentColor?: import('$lib/accent').AccentKey`),
    ).toEqual([])
  })

  it('exempts the files Vite loads and bun does not', () => {
    // The exemption has to be tight: a plain helper in src/routes is bun's to resolve like
    // any other module, and only SvelteKit's own conventional filenames are Vite's.
    for (const name of [
      '+page.ts',
      '+page.server.ts',
      '+layout.ts',
      '+layout.server.ts',
      '+server.ts',
      'hooks.client.ts',
      'app.d.ts',
    ]) {
      expect(VITE_LOADED.test(name)).toBe(true)
    }

    for (const name of [
      'accent.ts',
      'oklch.ts',
      'pageHelpers.ts',
      'server.ts',
      'layout.ts',
    ]) {
      expect(VITE_LOADED.test(name)).toBe(false)
    }
  })

  it('does not let one statement reach the next statement’s specifier', () => {
    // The original bug: a relative import followed by a type-only $lib import read as a
    // single offending statement.
    const source = [
      `import { narrateTransaction } from './narration'`,
      `import type { Posting } from '$lib/api'`,
    ].join('\n')
    expect(offendersIn(source)).toEqual([])
  })
})
