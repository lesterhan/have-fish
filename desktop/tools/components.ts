// A guard on each component's size (DESIGN.md, "Parts", rule 3). `components.test.ts` runs it
// over the window.

/** A component's script lines, the props it takes, and its `$state` declarations. */
export type Size = { lines: number; props: number; states: number }

/** What a component not in `HELD` is held to. A number at the limit passes. */
export const LIMITS: Size = { lines: 150, props: 10, states: 5 }

/** Each component over a limit, by its path under `renderer/`, at the size it has. */
export const HELD: Record<string, Size> = {
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
}

// Comments out of the count; strings aren't looked inside, which no component needs yet.
const strip = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')

/** The instance script's lines: its `<script …>` line without `module`, to `</script>`. */
export function scriptLinesIn(source: string): number {
  const script = /^\s*<script\b(?![^\n]*\smodule\b)[^\n]*\n([\s\S]*?)^\s*<\/script>/m.exec(
    source,
  )?.[1]
  return script ? script.split('\n').length - 1 : 0
}

/** The names the destructuring assigned from `$props()` takes, at its top level. */
export function propsIn(source: string): number {
  const code = strip(source)
  const props = code.search(/\$props\(\)/)
  if (props < 0) return 0
  const close = /\}\s*(?::[^=]*)?=\s*$/.exec(code.slice(0, props))
  if (!close) throw new Error('$props() must be destructured to be counted')
  let depth = 0
  let open = close.index
  while (open > 0) {
    open--
    const char = code[open] as string
    if (')]}'.includes(char)) depth++
    else if ('([{'.includes(char)) {
      if (depth === 0) break
      depth--
    }
  }
  depth = 0
  let names = 0
  let name = false
  for (const char of code.slice(open + 1, close.index)) {
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    else if (depth === 0 && char === ',') {
      if (name) names++
      name = false
      continue
    }
    if (depth === 0 && /\S/.test(char)) name = true
  }
  return name ? names + 1 : names
}

/** Each `$state(`, `$state<…>(` and `$state.raw(`, comments left out. */
export function statesIn(source: string): number {
  return [...strip(source).matchAll(/\$state(?:\.raw)?\s*[<(]/g)].length
}

export function sizeOf(source: string): Size {
  return { lines: scriptLinesIn(source), props: propsIn(source), states: statesIn(source) }
}

const NUMBERS = ['lines', 'props', 'states'] as const

/** One line per problem, each naming its file; none when every component holds. */
export function grownIn(
  sizes: Record<string, Size>,
  held: Record<string, Size>,
  limits: Size,
): string[] {
  const missing = Object.keys(held)
    .filter((file) => !(file in sizes))
    .map((file) => `${file}: held in the table, but there is no such file`)
  const grown = Object.entries(sizes).flatMap(([file, size]) => {
    const at = held[file]
    if (!at) {
      return NUMBERS.filter((n) => size[n] > limits[n]).map(
        (n) => `${file}: ${n} ${size[n]}, over the limit of ${limits[n]}`,
      )
    }
    if (NUMBERS.every((n) => size[n] <= limits[n])) {
      return [`${file}: within every limit, so take it out of the table`]
    }
    return NUMBERS.filter((n) => size[n] !== at[n]).map((n) =>
      size[n] > at[n]
        ? `${file}: ${n} ${size[n]}, grown past the ${at[n]} it is held at`
        : `${file}: ${n} ${size[n]}, below the ${at[n]} it is held at, so bring the table down`,
    )
  })
  return [...missing, ...grown]
}
