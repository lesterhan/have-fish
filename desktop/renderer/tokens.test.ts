// `tokens.css` is the only file that declares a colour, and its colours keep the contract in
// light and in dark. Both read files, so this runs on Node; `tsconfig.json` checks it.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { inkFailures, stepFailures } from '../shared/theme/contract'
import { readTheme } from '../shared/theme/css'
import { madeColoursIn, rawColoursIn } from '../tools/colours'
import { rawTimingsIn, rawTypeIn } from '../tools/sizes'

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

  test('no file makes a colour from them, which the contract would never see', () => {
    const made = appFiles().flatMap((file) =>
      madeColoursIn(readFileSync(join(DESKTOP, file), 'utf8')).map((c) => `${file}: ${c}`),
    )
    expect(made, 'Derive it in deriveTokens, and add its pairs to the contract').toEqual([])
  })
})

describe('type and timing live in tokens.css too', () => {
  const found = (detect: (source: string) => string[]) =>
    appFiles().flatMap((file) =>
      detect(readFileSync(join(DESKTOP, file), 'utf8')).map((v) => `${file}: ${v}`),
    )

  test('every font-size is a type step', () => {
    expect(found(rawTypeIn), 'Use a --text-* step from tokens.css').toEqual([])
  })

  test('reduced motion is one rule, in tokens.css', () => {
    const elsewhere = appFiles().filter((f) =>
      readFileSync(join(DESKTOP, f), 'utf8').includes('prefers-reduced-motion'),
    )
    expect(elsewhere, 'tokens.css sets every duration for it').toEqual([])
  })

  test('every duration is a motion token', () => {
    expect(found(rawTimingsIn), 'Use a --duration-* token from tokens.css').toEqual([])
  })
})

/** The row, band and base type each density sets: `tokens.css`'s first `:root` is Regular. */
function densitySteps(source: string) {
  const block = (selector: string) => {
    const at = source.indexOf(selector)
    return at === -1 ? '' : source.slice(at, source.indexOf('}', at))
  }
  const px = (text: string, name: string) => {
    const value = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(text)?.[1]
    return Number.parseFloat(value ?? 'NaN')
  }
  const steps = (text: string) => ({
    row: px(text, 'row'),
    band: px(text, 'band'),
    type: px(text, 'text-base'),
  })
  return {
    compact: steps(block("[data-density='compact']")),
    regular: steps(block(':root {')),
    comfortable: steps(block("[data-density='comfortable']")),
    large: steps(block("[data-density='large']")),
  }
}

/** DESIGN.md's density table, as the same steps. */
function tabledSteps(source: string) {
  const steps: Record<string, { row: number; band: number; type: number }> = {}
  for (const line of source.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (!/^\| (Compact|Regular \(default\)|Comfortable|Large) \|/.test(line)) continue
    const name = cells[1] === 'Regular (default)' ? 'regular' : (cells[1]?.toLowerCase() ?? '')
    steps[name] = {
      row: Number.parseFloat(cells[2] ?? ''),
      band: Number.parseFloat(cells[3] ?? ''),
      type: Number.parseFloat(cells[4] ?? ''),
    }
  }
  return steps
}

describe('the four densities are the ones DESIGN.md says', () => {
  const css = densitySteps(readFileSync(join(DESKTOP, TOKENS), 'utf8'))
  const table = tabledSteps(readFileSync(join(DESKTOP, '..', 'DESIGN.md'), 'utf8'))

  test('it read all four', () => {
    expect(Object.keys(css).sort()).toEqual(['comfortable', 'compact', 'large', 'regular'])
    expect(Object.keys(table).sort()).toEqual(['comfortable', 'compact', 'large', 'regular'])
  })

  test('Compact 30/26/13, Regular 33/26/14, Comfortable 40/26/14, Large 46/32/16', () => {
    expect(css).toEqual(table)
  })
})
