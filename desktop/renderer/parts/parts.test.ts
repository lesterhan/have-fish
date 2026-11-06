// What a part owns stays in it (DESIGN.md, "Parts"). Reads the files, so it runs on Node;
// `tsconfig.json` checks it.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { kbdsIn, listboxesIn, lookIn, otherWidthsIn } from '../../tools/layout'

const RENDERER = join(import.meta.dirname, '..')
const read = (file: string) => readFileSync(join(RENDERER, file), 'utf8')

const files = readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(svelte|ts|css|html)$/.test(f) && !/\.test\.ts$/.test(f))
  .sort()

/**
 * The files whose style is layout only. Each note that moves a screen onto the parts adds its
 * files, and the list ends as every place.
 */
const LAYOUT_ONLY = [
  'App.svelte',
  'SpendList.svelte',
  'SpendCard.svelte',
  'Accounts.svelte',
  'AccountList.svelte',
  'AccountPane.svelte',
]

describe('parts own what they draw', () => {
  test('it read the renderer', () => {
    expect(files).toContain('App.svelte')
    expect(files).toContain('parts/Keys.svelte')
  })

  test('a keycap is drawn only by Keys', () => {
    const elsewhere = files.filter((f) => f !== 'parts/Keys.svelte' && kbdsIn(read(f)) > 0)
    expect(elsewhere, 'Use <Keys action=…>').toEqual([])
  })

  test('a listbox, its options and its active descendant are only in Listbox and its Row', () => {
    const elsewhere = files.filter(
      // A Row is the Listbox's option, drawn for it.
      (f) =>
        !['parts/Listbox.svelte', 'parts/Row.svelte'].includes(f) &&
        listboxesIn(read(f)).length > 0,
    )
    expect(elsewhere, 'Use <Listbox>').toEqual([])
  })

  test('the one narrow width is the only one', () => {
    const widths = files.flatMap((f) => otherWidthsIn(read(f)).map((w) => `${f}: ${w}`))
    expect(widths, 'Below 44rem is narrow; there is no other width').toEqual([])
  })

  test.each(LAYOUT_ONLY)('%s styles only its layout', (file) => {
    expect(lookIn(read(file)), 'Colour, type, borders and the rest belong to a part').toEqual([])
  })
})
