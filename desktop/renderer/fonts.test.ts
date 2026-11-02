// The fonts ship inside the app, and the SIL Open Font License asks that its text travel with
// them: every font `fonts.css` imports has its licence in `public/licenses/`, which the build
// copies beside it, word for word what the installed package carries. Reads files, so this
// runs on Node; `tsconfig.json` checks it.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const DESKTOP = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(DESKTOP, path), 'utf8')

const FONTS = [
  ...read('renderer/fonts.css').matchAll(/@import\s+'@fontsource-variable\/([^/']+)\//g),
].map((m) => m[1] as string)

describe('the bundled fonts', () => {
  test('are the four the tokens name', () => {
    expect(FONTS.sort()).toEqual([
      'atkinson-hyperlegible-mono',
      'fira-code',
      'ibm-plex-sans',
      'source-serif-4',
    ])
  })

  test.each(FONTS)('%s ships its licence', (name) => {
    const shipped = join(DESKTOP, 'renderer/public/licenses', `${name}.txt`)
    expect(existsSync(shipped), `renderer/public/licenses/${name}.txt`).toBe(true)
    const upstream = read(`node_modules/@fontsource-variable/${name}/LICENSE`)
    expect(readFileSync(shipped, 'utf8')).toBe(upstream)
    expect(upstream).toContain('SIL Open Font License')
  })

  test('are the families the tokens ask for, each with a fallback', () => {
    const tokens = read('renderer/tokens.css')
    expect(tokens).toContain("--font: 'IBM Plex Sans Variable', system-ui, sans-serif;")
    expect(tokens).toContain("--font-serif: 'Source Serif 4 Variable', Georgia, serif;")
    expect(tokens).toContain(
      "--font-figures: 'Atkinson Hyperlegible Mono Variable', ui-monospace, monospace;",
    )
    expect(tokens).toContain("--font-code: 'Fira Code Variable', ui-monospace, monospace;")
  })
})
