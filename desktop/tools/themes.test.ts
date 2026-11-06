import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { coloursIn, renderColours, TOKENS, withColours } from './themes'

const css = readFileSync(TOKENS, 'utf8')

test('tokens.css holds the colours deriveTokens gives the built-ins', () => {
  expect(coloursIn(css), 'run `bun run themes`').toBe(renderColours())
})

test('a value edited by hand no longer matches', () => {
  const block = coloursIn(css) as string
  const edited = css.replace(block, block.replace(/(--color-text: )#[0-9a-f]{6}/, '$1#000000'))
  expect(coloursIn(edited)).not.toBe(renderColours())
  expect(withColours(edited)).toBe(css)
})

test('a file without the markers is refused, not rewritten whole', () => {
  expect(coloursIn(':root {}')).toBeNull()
  expect(() => withColours(':root {}')).toThrow('markers')
})
