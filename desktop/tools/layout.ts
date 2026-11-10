// Guards for what parts own (DESIGN.md, "Parts"): a `<kbd>` only in `Keys`, one narrow width,
// and a place's style that is layout only. `renderer/parts/parts.test.ts` runs them over the app.

const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

/** Each `<kbd` in markup. */
export function kbdsIn(source: string): number {
  return [...strip(source).matchAll(/<kbd[\s>]/g)].length
}

/** Each `role="listbox"`, `role="option"`, `role="tree"`, `role="treeitem"` and `aria-activedescendant` in markup. */
export function listboxesIn(source: string): string[] {
  return [
    ...strip(source).matchAll(
      /role=["']?(?:listbox|option|tree|treeitem)\b["']?|aria-activedescendant/g,
    ),
  ].map(([found]) => found)
}

/** The one narrow width (DESIGN.md, "Layout"). */
export const NARROW_WIDTH = '44rem'

/** Each width a media query names that isn't the narrow one. */
export function otherWidthsIn(source: string): string[] {
  return [...strip(source).matchAll(/\((?:max|min)-width\s*:\s*([^)]+)\)/g)]
    .map(([, width]) => (width as string).trim())
    .filter((width) => width !== NARROW_WIDTH)
}

/** What a place's style may set: where things go and how big, never how they look. */
const LAYOUT = new RegExp(
  `^(${[
    'display',
    'grid(-[a-z-]+)?',
    'gap',
    'row-gap',
    'column-gap',
    '(min-|max-)?(width|height|inline-size|block-size)',
    'order',
    '(align|justify|place)-(items|content|self)',
    'flex(-[a-z]+)?',
    '(margin|padding)(-[a-z-]+)?',
    'position',
    'inset(-[a-z-]+)?',
    'top|right|bottom|left',
    'overflow(-[xy])?',
    'box-sizing',
    'z-index',
  ].join('|')})$`,
)

/** The properties in `source`'s `<style>` that aren't layout. */
export function lookIn(source: string): string[] {
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? ''
  return [...strip(style).matchAll(/(?:^|[;{\s])([a-z-]+)\s*:(?![a-z-]*\s*[{,])/g)]
    .map(([, property]) => property as string)
    .filter((property) => !LAYOUT.test(property))
}
