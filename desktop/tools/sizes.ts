// Finds a type size or a timing written in a component instead of read from `tokens.css`, as
// `colours.ts` does for colour. `renderer/tokens.test.ts` runs both over the app.

/** Comments, which may quote the values they're about. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

const FONT_SIZE = /font-size\s*:\s*([^;}"\n]+)/g

/** A type step, or a refusal to set one. */
const TYPE_OK = /^(var\(--text-[a-z]+\)|inherit|unset)$/

export function rawTypeIn(source: string): string[] {
  return [...strip(source).matchAll(FONT_SIZE)]
    .map(([, value]) => (value as string).trim())
    .filter((value) => !TYPE_OK.test(value))
    .map((value) => `font-size: ${value}`)
}

const TIMED = /(?:transition|animation)(?:-duration|-delay)?\s*:\s*([^;}"\n]+)/g

/** A time that isn't zero: `150ms`, `.42s`, `1s`. */
const TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g

export function rawTimingsIn(source: string): string[] {
  return [...strip(source).matchAll(TIMED)].flatMap(([, value]) =>
    [...(value as string).matchAll(TIME)]
      .filter(([, n]) => Number(n) !== 0)
      .map(([time]) => time as string),
  )
}
