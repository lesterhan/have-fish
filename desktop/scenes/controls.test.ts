// The bench's rules. Some read DESIGN.md, tokens.css or main/window.ts, so this runs on Node;
// `tsconfig.json` checks it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { NARROW } from '../renderer/narrow'
import { DENSITIES } from '../shared/density'
import { readTheme } from '../shared/theme/css'
import { BUILTINS } from '../shared/theme/theme'
import {
  type Bench,
  benchOf,
  CONTROLS,
  DENSITY_STEPS,
  densityFor,
  densityLabel,
  framesOf,
  rootStyleOf,
  SHOWN,
  searchOf,
  WIDTHS,
  widthOf,
} from './controls'
import { SCENES, type Scene, sceneNamed } from './scenes'

const DESKTOP = join(import.meta.dirname, '..')
const read = (file: string) => readFileSync(join(DESKTOP, file), 'utf8')

const DEFAULTS: Bench = { scene: 'ledger/year', density: 'regular', width: 'full', shown: 'light' }

const named = (name: string): Scene => {
  const scene = sceneNamed(name)
  if (scene === null) throw new Error(`no scene ${name}`)
  return scene
}

describe('benchOf reads the bench from its address', () => {
  test('a full address is the view it names', () => {
    expect(benchOf('?scene=ledger%2Fyear&density=compact&width=narrow&shown=dark')).toEqual({
      scene: 'ledger/year',
      density: 'compact',
      width: 'narrow',
      shown: 'dark',
    })
  })

  test('an empty address is the defaults', () => {
    expect(benchOf('')).toEqual(DEFAULTS)
    expect(benchOf('?')).toEqual(DEFAULTS)
  })

  test('a field it cannot read falls to its default alone', () => {
    expect(benchOf('?scene=nope&density=huge&width=wide&shown=sepia')).toEqual(DEFAULTS)
    expect(benchOf('?scene=reports%2Fyear&width=wide')).toEqual({
      scene: 'reports/year',
      density: 'regular',
      width: 'full',
      shown: 'light',
    })
  })

  test('a scene keeps its own density until the address names another', () => {
    expect(benchOf('?scene=ledger%2Fcompact').density).toBe('compact')
    expect(benchOf('?scene=ledger%2Fcompact&density=large').density).toBe('large')
  })
})

describe('searchOf writes the bench into an address', () => {
  test('every bench reads back as itself', () => {
    const ends = [SCENES[0], SCENES.at(-1)].map((scene) => scene?.name ?? '')
    const benches = ends.flatMap((scene) =>
      DENSITIES.flatMap((density) =>
        WIDTHS.flatMap((width) => SHOWN.map((shown) => ({ scene, density, width, shown }))),
      ),
    )
    expect(benches).toHaveLength(72)
    for (const bench of benches) expect(benchOf(searchOf(bench))).toEqual(bench)
    expect(
      searchOf({ scene: 'ledger/year', density: 'compact', width: 'narrow', shown: 'dark' }),
    ).toBe('?scene=ledger%2Fyear&density=compact&width=narrow&shown=dark')
  })
})

describe('framesOf frames the scene once per theme shown', () => {
  test('dark at the narrow width is one dark frame 704px wide', () => {
    expect(
      framesOf({ scene: 'ledger/year', density: 'compact', width: 'narrow', shown: 'dark' }),
    ).toEqual([
      {
        src: './?scene=ledger%2Fyear&density=compact',
        theme: BUILTINS['graphite-dark'],
        width: 704,
      },
    ])
  })

  test('both is the scene light, then dark, sharing the width', () => {
    const frames = framesOf({
      scene: 'ledger/year',
      density: 'regular',
      width: 'full',
      shown: 'both',
    })
    expect(frames).toHaveLength(2)
    for (const frame of frames) {
      expect(frame.src).toBe('./?scene=ledger%2Fyear&density=regular')
      expect(frame.width).toBeNull()
    }
    expect(frames[0]?.theme).toEqual(BUILTINS['graphite-light'])
    expect(frames[1]?.theme).toEqual(BUILTINS['graphite-dark'])
  })

  test('light at the minimum width is one light frame 360px wide', () => {
    expect(
      framesOf({ scene: 'accounts/year', density: 'large', width: 'minimum', shown: 'light' }),
    ).toEqual([
      {
        src: './?scene=accounts%2Fyear&density=large',
        theme: BUILTINS['graphite-light'],
        width: 360,
      },
    ])
  })
})

describe('widthOf', () => {
  test("full shares the bench, narrow is the narrow layout's widest, minimum the window's", () => {
    expect(widthOf('full')).toBeNull()
    expect(NARROW).toBe('(max-width: 44rem)')
    expect(widthOf('narrow')).toBe(704)
    expect(widthOf('minimum')).toBe(360)
    const minWidth = /^\s*minWidth: (\d+),$/m.exec(read('main/window.ts'))?.[1]
    expect(minWidth).toBe('360')
  })
})

describe('rootStyleOf', () => {
  test("paints a built-in's scheme and exactly tokens.css's colours for it", () => {
    const tokens = readTheme(read('renderer/tokens.css'))
    expect(Object.keys(tokens.dark).length).toBeGreaterThan(20)
    expect(Object.keys(tokens.light).length).toBeGreaterThan(20)

    const { 'color-scheme': dark, ...darkColours } = rootStyleOf(BUILTINS['graphite-dark'])
    expect(dark).toBe('dark')
    expect(darkColours).toEqual(tokens.dark)

    const { 'color-scheme': light, ...lightColours } = rootStyleOf(BUILTINS['graphite-light'])
    expect(light).toBe('light')
    expect(lightColours).toEqual(tokens.light)
  })
})

describe('the density labels', () => {
  test("each density's row and base type are DESIGN.md's", () => {
    const design = readFileSync(join(DESKTOP, '..', 'DESIGN.md'), 'utf8')
    expect(design).toContain('### Space and density')
    const names = {
      compact: 'Compact',
      regular: 'Regular \\(default\\)',
      comfortable: 'Comfortable',
      large: 'Large',
    }
    for (const density of DENSITIES) {
      const { row, type } = DENSITY_STEPS[density]
      const line = new RegExp(
        `^\\| ${names[density]} \\| ${row}px \\| \\d+px \\| ${type}px \\|$`,
        'm',
      )
      expect(design, density).toMatch(line)
    }
  })

  test('say the row and the type, and the bar holds the four controls in order', () => {
    expect(densityLabel('compact')).toBe('Compact · 30px rows · 13px type')
    expect(densityLabel('regular')).toBe('Regular · 33px rows · 14px type')
    expect(densityLabel('large')).toBe('Large · 46px rows · 16px type')
    const values = (key: string) =>
      CONTROLS.find((control) => control.key === key)?.choices.map((choice) => choice.value)
    expect(CONTROLS.map((control) => control.key)).toEqual(['scene', 'density', 'width', 'shown'])
    expect(values('scene')).toEqual(SCENES.map((scene) => scene.name))
    expect(values('density')).toEqual([...DENSITIES])
    expect(values('width')).toEqual([...WIDTHS])
    expect(values('shown')).toEqual([...SHOWN])
  })
})

describe('densityFor', () => {
  test("a density asked for stands over the scene's own, and nothing else does", () => {
    expect(densityFor(named('ledger/compact'), 'large')).toBe('large')
    expect(densityFor(named('ledger/compact'), null)).toBe('compact')
    expect(densityFor(named('ledger/compact'), 'huge')).toBe('compact')
    expect(densityFor(named('ledger/year'), null)).toBeUndefined()
    expect(densityFor(named('ledger/year'), 'compact')).toBe('compact')
  })
})
