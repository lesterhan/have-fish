// Finds money or a day written out by hand, outside `renderer/format.ts`, and a component drawing
// one itself rather than through `Money` and `Day`. `tools/formats.test.ts` runs both over the
// window (see #609, #611).

/**
 * A field shown as it's stored: `{t.date}`, `{start.amount}`. An attribute's value isn't text, and
 * `copy`'s `date` and `amount` are a field's label.
 */
const RAW_FIELD = /(?<![=\w$])\{\s*(?!copy\.)[\w.?]+\.(?:date|amount)\s*\}/g

/** An amount and its code side by side: `${amount} ${currency}`, or `{a} {m.currency}` in markup. */
const BESIDE_CODE = [
  /\$\{[^}]*\}\s+\$\{[^}]*currency[^}]*\}/g,
  /(?<![=\w$])\{[^{}]*\}\s+\{[^{}]*\.currency\s*\}/g,
]

/** A formatter of its own, which would read differently from the rest. */
const OWN_FORMAT = /\bIntl\.(?:NumberFormat|DateTimeFormat)\b|\.toLocale(?:Date|Time)?String\(/g

/** Comments, which may show what not to write. */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')

export function rawFormatsIn(source: string): string[] {
  const clean = stripComments(source)
  return [RAW_FIELD, ...BESIDE_CODE, OWN_FORMAT].flatMap((pattern) =>
    [...clean.matchAll(pattern)].map(([found]) => found),
  )
}

/** A component's own call to a formatter, where a `Money` or a `Day` would draw it. */
const DRAWN_HERE = /\b(?:money|day|amountsText|moneyParts|bandDay)\(/g

/** In a component, each amount or day it formats itself instead of drawing a `Money` or a `Day`. */
export function drawnHereIn(source: string): string[] {
  return [...stripComments(source).matchAll(DRAWN_HERE)].map(([found]) => found)
}
