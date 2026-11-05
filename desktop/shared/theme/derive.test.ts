import { describe, expect, test } from 'vitest'
import { INK, inkFailures, STEPS, stepFailures } from './contract'
import { backgroundFor, deriveTokens, RUNGS, schemesOf } from './derive'
import { hexToOklch, oklchToHex } from './oklch'
import { BUILTINS, type Theme } from './theme'

const LIGHT = BUILTINS['graphite-light']
const DARK = BUILTINS['graphite-dark']

// U2's picked looks, from the prototype's own derivation: ochre in light, persimmon in dark.
const OCHRE_LIGHT = {
  '--color-sidebar': '#e3ddd5',
  '--color-background': '#fffbf7',
  '--color-band': '#f3ede5',
  '--color-selected': '#f3e3b7',
  '--color-rule': '#e1dbd4',
  '--color-border': '#847f78',
  '--color-bar': '#71675a',
  '--color-muted': '#605b55',
  '--color-text': '#1e1a14',
  '--color-accent': '#705800',
  '--color-on-accent': '#fefbf8',
  '--color-in': '#146d34',
  '--color-error': '#ac312c',
  '--color-assets': '#006787',
  '--color-liabilities': '#924500',
  '--color-expenses': '#724695',
  '--color-income': '#067132',
}

const PERSIMMON_DARK = {
  '--color-sidebar': '#0e0a06',
  '--color-background': '#1d1913',
  '--color-band': '#28241e',
  '--color-selected': '#472216',
  '--color-rule': '#34302a',
  '--color-border': '#76716a',
  '--color-bar': '#a19788',
  '--color-muted': '#b2ada6',
  '--color-text': '#f2ece4',
  '--color-accent': '#ff8762',
  '--color-on-accent': '#13110f',
  '--color-in': '#79ca8b',
  '--color-error': '#ff7f73',
  '--color-assets': '#47c7f8',
  '--color-liabilities': '#f99e65',
  '--color-expenses': '#cea0f7',
  '--color-income': '#76cf8a',
}

describe('deriveTokens', () => {
  test('Graphite light comes out as the picked look', () => {
    expect(deriveTokens(LIGHT)).toMatchObject(OCHRE_LIGHT)
  })

  test('Graphite dark comes out as the picked look', () => {
    expect(deriveTokens(DARK)).toMatchObject(PERSIMMON_DARK)
  })

  test.each([LIGHT, DARK])('$name puts each surface and ink on its rung', (theme) => {
    const tokens = deriveTokens(theme)
    const i = theme.scheme === 'light' ? 0 : 1
    for (const [rung, l] of Object.entries(RUNGS)) {
      const hex = tokens[`--color-${rung}`] as string
      // A byte of rounding moves lightness by well under this.
      expect(hexToOklch(hex).l, rung).toBeCloseTo(l[i], 2)
    }
  })

  test('the card is a third of the way from the background to the selection', () => {
    for (const theme of [LIGHT, DARK]) {
      const t = deriveTokens(theme)
      const [bg, card, sel] = ['background', 'card', 'selected'].map(
        (n) => hexToOklch(t[`--color-${n}`] as string).l,
      ) as [number, number, number]
      expect(card).toBeCloseTo(bg + (sel - bg) / 3, 2)
    }
  })

  test('the money and account colours are the same whatever the theme', () => {
    const other: Theme = { ...LIGHT, neutralHue: 250, accentHue: 300 }
    const fixed = ['in', 'error', 'assets', 'liabilities', 'expenses', 'income'].map(
      (n) => `--color-${n}`,
    )
    const pick = (p: Record<string, string>) => fixed.map((k) => p[k])
    expect(pick(deriveTokens(other))).toEqual(pick(deriveTokens(LIGHT)))
  })
})

describe('the built-ins keep the contract', () => {
  const schemes = schemesOf(LIGHT, DARK)

  test('every ink on every surface it sits on, in both schemes', () => {
    expect(inkFailures(schemes)).toEqual([])
  })

  test('every surface a real step from the background, alike in both schemes', () => {
    expect(stepFailures(schemes)).toEqual([])
  })

  test('inputs that fail are refused, naming the pair', () => {
    // The rungs pin lightness, so only a neutral at the schema's limit gets this close.
    const failing: Theme = { ...LIGHT, neutralHue: 350, neutralChroma: 0.1, accentHue: 355 }
    expect(inkFailures(schemesOf(failing, DARK))).toEqual([
      expect.objectContaining({ scheme: 'light', ink: '--color-income', on: '--color-sidebar' }),
    ])
  })

  test('muted text moved off its rung fails, naming the pair', () => {
    // No inputs can do this: muted's lightness is a rung, not an input.
    const light = {
      ...deriveTokens(LIGHT),
      '--color-muted': oklchToHex({ l: 0.6, c: 0.012, h: 75 }),
    }
    const failures = inkFailures({ light, dark: deriveTokens(DARK) })
    expect(failures).toContainEqual(
      expect.objectContaining({ scheme: 'light', ink: '--color-muted', on: '--color-sidebar' }),
    )
  })
})

test('the contract checks 37 pairs and 4 steps in each scheme', () => {
  expect([INK.length, STEPS.length]).toEqual([37, 4])
})

describe('backgroundFor', () => {
  const background = (name: 'graphite-light' | 'graphite-dark') =>
    deriveTokens(BUILTINS[name])['--color-background']

  test.each([
    ['graphite-light', false, 'graphite-light'],
    ['graphite-light', true, 'graphite-light'],
    ['graphite-dark', false, 'graphite-dark'],
    ['system', false, 'graphite-light'],
    ['system', true, 'graphite-dark'],
  ] as const)('%s, with the system dark %s, is %s', (choice, dark, shows) => {
    expect(backgroundFor(choice, dark)).toBe(background(shows))
  })
})
