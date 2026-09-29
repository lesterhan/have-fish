/**
 * The fonts ship inside the app (#491), so their licences ship with them.
 *
 * Both are under the SIL Open Font License, which asks that the licence travel with the font
 * software. The woff2 files end up in the build and in the local binary; `static/licenses/`
 * puts the text beside them. This test ties the two together: every font package `base.css`
 * imports has its licence there, word for word what the installed package carries, so an
 * upgrade or a new font can't leave it stale or missing.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FRONTEND = join(import.meta.dir, '..', '..')
const BASE = readFileSync(join(FRONTEND, 'src/styles/base.css'), 'utf8')

const PACKAGES = [...BASE.matchAll(/@import\s+'@fontsource-variable\/([^/']+)\//g)].map(
  (m) => m[1] as string,
)

describe('the bundled fonts', () => {
  it('are the two the tokens name', () => {
    expect(PACKAGES.sort()).toEqual(['jetbrains-mono', 'source-serif-4'])
  })

  it.each(PACKAGES)('%s ships its licence', (name) => {
    const shipped = join(FRONTEND, 'static/licenses', `${name}.txt`)
    expect(existsSync(shipped)).toBe(true)
    const upstream = join(FRONTEND, 'node_modules/@fontsource-variable', name, 'LICENSE')
    expect(readFileSync(shipped, 'utf8')).toBe(readFileSync(upstream, 'utf8'))
    expect(readFileSync(shipped, 'utf8')).toContain('SIL Open Font License')
  })

  it('are the families the tokens ask for', () => {
    const tokens = readFileSync(join(FRONTEND, 'src/styles/tokens.css'), 'utf8')
    expect(tokens).toContain("--font-serif: 'Source Serif 4 Variable'")
    expect(tokens).toContain("--font-mono: 'JetBrains Mono Variable'")
  })
})
