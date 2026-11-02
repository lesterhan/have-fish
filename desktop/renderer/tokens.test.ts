// `tokens.css` is the only file that declares a colour, and its colours keep the contract in
// light and in dark. Both read files, so this runs on Node; `tsconfig.json` checks it.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { rawColoursIn } from '../tools/colours'
import { inkFailures, stepFailures } from './theme/contract'
import { readTheme } from './theme/css'

const DESKTOP = join(import.meta.dirname, '..')
const TOKENS = 'renderer/tokens.css'

describe('tokens.css keeps the colour contract', () => {
  const theme = readTheme(readFileSync(join(DESKTOP, TOKENS), 'utf8'))

  test('ink is legible on every surface it sits on', () => {
    expect(inkFailures(theme)).toEqual([])
  })

  test('every surface is a real step from the one beneath it, alike in both schemes', () => {
    expect(stepFailures(theme)).toEqual([])
  })
})

/** The app's code: both processes, the bridge, and the page. */
const READ = ['main', 'preload', 'renderer', 'shared']

const appFiles = () =>
  READ.flatMap((dir) =>
    readdirSync(join(DESKTOP, dir), { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f)),
  )
    .filter((f) => /\.(svelte|ts|css|html)$/.test(f) && !/\.test\.ts$/.test(f) && f !== TOKENS)
    .sort()

describe('colour lives in tokens.css and nowhere else', () => {
  test('it read the app', () => {
    const files = appFiles()
    expect(files).toContain('renderer/App.svelte')
    expect(files).toContain('renderer/index.html')
    expect(files.length).toBeGreaterThan(30)
  })

  test('no other file declares a colour', () => {
    const raw = appFiles().flatMap((file) =>
      rawColoursIn(readFileSync(join(DESKTOP, file), 'utf8')).map((c) => `${file}: ${c}`),
    )
    expect(raw, 'Make each a token in tokens.css, and add it to the contract').toEqual([])
  })
})
