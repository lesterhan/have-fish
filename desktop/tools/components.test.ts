import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, test } from 'vitest'
import {
  grownIn,
  HELD,
  LIMITS,
  propsIn,
  type Size,
  scriptLinesIn,
  sizeOf,
  statesIn,
} from './components'

describe('scriptLinesIn', () => {
  it('counts the lines between the script tags', () => {
    expect(scriptLinesIn('<script lang="ts">\n  let a = 1\n  let b = 2\n</script>\n<p>x</p>')).toBe(
      2,
    )
  })

  it('is 0 with no script', () => {
    expect(scriptLinesIn('<p>x</p>')).toBe(0)
  })

  it("counts the script's lines only, not the markup's or the style's", () => {
    const source =
      '<script>\n  let a = 1\n</script>\n\n<p>x</p>\n<p>y</p>\n\n<style>\n  p { gap: 0; }\n</style>\n'
    expect(scriptLinesIn(source)).toBe(1)
  })
})

describe('propsIn', () => {
  it('counts each name the destructuring takes, a rest included', () => {
    expect(propsIn('let { a, b = 1, onpick = () => {}, ...rest }: Props = $props()')).toBe(4)
  })

  it('counts the same over six lines, a comment between two names', () => {
    const source = `let {
    a,
    // what b is for, with a comma
    b = 1,
    onpick = () => {},
    ...rest
  }: Props = $props()`
    expect(propsIn(source)).toBe(4)
  })

  it('takes a comma inside a default for no prop', () => {
    expect(propsIn('let { a = [1, 2], b = { x: 1, y: 2 }, c = f(1, 2) }: Props = $props()')).toBe(3)
  })

  it('counts a renamed prop, with no type', () => {
    expect(propsIn('let { a: renamed, b } = $props()')).toBe(2)
  })

  it('is 0 with no $props()', () => {
    expect(propsIn('<script>\n  let a = $state(0)\n</script>')).toBe(0)
  })
})

describe('statesIn', () => {
  it('counts $state, a typed $state and $state.raw', () => {
    expect(
      statesIn(
        'let a = $state(0)\nlet b = $state<string | null>(null)\nlet c = $state.raw(new Set())',
      ),
    ).toBe(3)
  })

  it('takes comments and $derived for no state', () => {
    expect(statesIn('// let a = $state(0)\n/* $state(1) */\nlet d = $derived(a)')).toBe(0)
  })
})

describe('sizeOf', () => {
  it('is all zeros for nothing', () => {
    expect(sizeOf('')).toEqual({ lines: 0, props: 0, states: 0 })
  })
})

describe('grownIn', () => {
  const size = (lines: number, props: number, states: number): Size => ({ lines, props, states })
  const listbox = size(269, 28, 5)

  it('passes a component at the limit', () => {
    expect(grownIn({ 'A.svelte': size(150, 10, 5) }, {}, LIMITS)).toEqual([])
  })

  it('names the file, the number, what it is and the limit when one is over', () => {
    const found = grownIn({ 'A.svelte': size(151, 0, 0) }, {}, LIMITS)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/A\.svelte.*lines.*151.*150/)
  })

  it('gives a line for each number over', () => {
    const found = grownIn({ 'A.svelte': size(10, 11, 6) }, {}, LIMITS)
    expect(found).toHaveLength(2)
    expect(found[0]).toMatch(/A\.svelte.*props.*11.*10/)
    expect(found[1]).toMatch(/A\.svelte.*states.*6.*5/)
  })

  it('passes a component held at its size', () => {
    expect(grownIn({ 'A.svelte': listbox }, { 'A.svelte': listbox }, LIMITS)).toEqual([])
  })

  it('catches a held component that grew past what it is held at', () => {
    const found = grownIn({ 'A.svelte': size(270, 28, 5) }, { 'A.svelte': listbox }, LIMITS)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/A\.svelte.*lines.*270.*269/)
  })

  it('catches a table number higher than its file, so the table comes down', () => {
    const found = grownIn({ 'A.svelte': size(268, 28, 5) }, { 'A.svelte': listbox }, LIMITS)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/A\.svelte.*lines.*268.*269/)
  })

  it('catches a held component back within every limit, so it comes out of the table', () => {
    const found = grownIn({ 'A.svelte': size(100, 9, 5) }, { 'A.svelte': listbox }, LIMITS)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/A\.svelte/)
  })

  it('catches the table holding a file that is not there', () => {
    const found = grownIn({}, { 'Gone.svelte': size(200, 0, 0) }, LIMITS)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/Gone\.svelte/)
  })
})

describe('every component holds to its size', () => {
  const RENDERER = join(import.meta.dirname, '../renderer')
  const read = (file: string) => readFileSync(join(RENDERER, file), 'utf8')
  const files = readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.svelte'))
    .map((f) => f.replaceAll('\\', '/'))
  const sizes = Object.fromEntries(files.map((f) => [f, sizeOf(read(f))]))

  test('it read the window', () => {
    expect(files).toContain('Spends.svelte')
    expect(files).toContain('parts/Listbox.svelte')
    expect(files.length).toBeGreaterThanOrEqual(30)
  })

  test('it counts the real files as they were counted by hand', () => {
    expect(sizes['parts/Empty.svelte']).toEqual({ lines: 4, props: 1, states: 0 })
    expect(sizes['SpendCard.svelte']).toEqual({ lines: 162, props: 9, states: 2 })
    expect(sizes['parts/Listbox.svelte']).toEqual({ lines: 269, props: 28, states: 5 })
    expect(sizes['Composer.svelte']).toEqual({ lines: 267, props: 10, states: 14 })
    expect(sizes['App.svelte']).toEqual({ lines: 223, props: 0, states: 2 })
  })

  test('no component has grown, and the table flatters none', () => {
    expect(grownIn(sizes, HELD, LIMITS)).toEqual([])
  })

  test('the table holds the twelve over a limit, and no other', () => {
    expect(HELD).toEqual({
      'AccountPane.svelte': { lines: 118, props: 9, states: 8 },
      'Accounts.svelte': { lines: 160, props: 3, states: 7 },
      'App.svelte': { lines: 223, props: 0, states: 2 },
      'Composer.svelte': { lines: 267, props: 10, states: 14 },
      'Reports.svelte': { lines: 279, props: 3, states: 12 },
      'SpendCard.svelte': { lines: 162, props: 9, states: 2 },
      'SpendList.svelte': { lines: 198, props: 23, states: 4 },
      'Spends.svelte': { lines: 250, props: 4, states: 9 },
      'parts/Chip.svelte': { lines: 40, props: 11, states: 0 },
      'parts/Listbox.svelte': { lines: 269, props: 28, states: 5 },
      'parts/PathPicker.svelte': { lines: 219, props: 16, states: 6 },
      'parts/Row.svelte': { lines: 56, props: 17, states: 0 },
    })
  })

  test('AccountList takes rows, selectedId, onselect and onopen, and no accounts', () => {
    const list = read('AccountList.svelte')
    expect(propsIn(list)).toBe(4)
    expect(list).toContain('let { rows, selectedId, onselect, onopen }: Props = $props()')
    expect(list).not.toMatch(/^\s*accounts: ListedAccount\[\]/m)
    expect(read('Accounts.svelte')).not.toContain('accounts={ordered}')
  })
})

describe('the type checkers catch what is unused', () => {
  const ROOT = join(import.meta.dirname, '../..')
  const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

  test("desktop's and core's tsconfig set both flags, and the window's extends desktop's", () => {
    for (const file of ['desktop/tsconfig.json', 'core/tsconfig.json']) {
      expect(read(file), file).toMatch(/"noUnusedLocals": true/)
      expect(read(file), file).toMatch(/"noUnusedParameters": true/)
    }
    expect(read('desktop/tsconfig.web.json')).toMatch(/"extends": "\.\/tsconfig\.json"/)
  })

  test('DESIGN.md, Parts, rule 3 names the guard', () => {
    const rule = /\n3\. \*\*Use, extend, or replace\.\*\*[\s\S]*?(?=\n4\. )/.exec(read('DESIGN.md'))
    expect(rule?.[0]).toMatch(/tools\/components\.test\.ts[^.]*\.\s*$/)
  })
})
