// The theme lab's rules. Some read the built-ins' files, so this runs on Node; `tsconfig.json`
// checks it.

import { describe, expect, test } from 'vitest'
import { Theme } from '../shared/theme/theme'
import { SLIDERS } from './lab'

describe('SLIDERS', () => {
  test("are Theme's numbers, in its order", () => {
    const numbers = Object.entries(Theme.shape)
      .filter(([, schema]) => schema.type === 'number')
      .map(([key]) => key)
    expect(numbers).toEqual(['neutralHue', 'neutralChroma', 'accentHue'])
    expect(SLIDERS.map((slider) => slider.key)).toEqual(numbers)
  })
})
