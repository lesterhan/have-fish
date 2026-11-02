import { describe, expect, test } from 'vitest'
import { readTheme } from './css'

const TOKENS = `
/* --color-comment: #123456; */
:root {
  color-scheme: light dark;
  --space-1: 0.25rem;
  --color-text: #1b1b1b;
  --color-background: #FFFFFF;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-text: #ececec;
  }
}

body {
  color: var(--color-text);
}
`

describe('readTheme', () => {
  test('reads the colours of :root as light, and the dark media block over them as dark', () => {
    expect(readTheme(TOKENS)).toEqual({
      light: { '--color-text': '#1b1b1b', '--color-background': '#ffffff' },
      // Not redeclared in dark, so dark keeps light's, as the page does.
      dark: { '--color-text': '#ececec', '--color-background': '#ffffff' },
    })
  })

  test('ignores comments, other tokens and rules that only use colours', () => {
    const { light } = readTheme(TOKENS)
    expect(Object.keys(light)).toEqual(['--color-text', '--color-background'])
  })

  test('a colour it cannot measure is a mistake in the file', () => {
    expect(() => readTheme(':root { --color-text: rgb(0 0 0); }')).toThrow('--color-text')
    expect(() => readTheme(':root { --color-text: #000; }')).toThrow('--color-text')
  })

  test('a file with no :root block is a mistake in the file', () => {
    expect(() => readTheme('body { color: red; }')).toThrow(':root')
  })
})
