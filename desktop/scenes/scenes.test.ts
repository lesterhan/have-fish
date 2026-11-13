import { describe, expect, test } from 'vitest'
import { PLACES } from '../renderer/shell/places'
import { COMPOSER, SCENES, sceneNamed } from './scenes'

describe('SCENES', () => {
  test('the eight to start, each once', () => {
    const eight = [
      'accounts/year',
      'ledger/compact',
      'ledger/empty',
      'ledger/spend-open',
      'ledger/starter',
      'ledger/year',
      'reports/category-open',
      'reports/year',
    ]
    expect(
      SCENES.filter((scene) => eight.includes(scene.name))
        .map((scene) => scene.name)
        .sort(),
    ).toEqual(eight)
  })

  test('the six design argues about, each once', () => {
    const six = [
      'accounts/adding',
      'ledger/chip-changing',
      'ledger/composer-typing',
      'ledger/palette',
      'ledger/path-picker',
      'ledger/refused',
    ]
    expect(
      SCENES.filter((scene) => six.includes(scene.name))
        .map((scene) => scene.name)
        .sort(),
    ).toEqual(six)
    expect(SCENES).toHaveLength(14)
  })

  test("every scene's name starts with a place, then a slash", () => {
    for (const scene of SCENES) {
      const [place, state, ...rest] = scene.name.split('/')
      expect(PLACES).toContain(place)
      expect(state).toBeTruthy()
      expect(rest).toEqual([])
    }
  })

  test('the shapes each scene pins', () => {
    const named = (name: string) => {
      const scene = sceneNamed(name)
      if (scene === null) throw new Error(`no scene ${name}`)
      return scene
    }
    expect(named('ledger/empty')).toMatchObject({ fixture: 'empty', steps: [] })
    expect(named('ledger/compact')).toMatchObject({ fixture: 'year', density: 'compact' })
    expect(named('ledger/spend-open').steps).toEqual([{ key: 'Enter' }])
    expect(named('accounts/year').steps).toEqual([{ action: 'showAccounts' }])
    expect(named('reports/year').steps).toEqual([{ action: 'showReports' }])
    const [first, ...rest] = named('reports/category-open').steps
    expect(first).toEqual({ action: 'showReports' })
    expect(rest).toHaveLength(2)
    expect(rest[0]).toHaveProperty('click')
    expect(rest[0]).toEqual(rest[1])
  })
})

describe('the six new scenes', () => {
  const scene = (name: string) => {
    const found = sceneNamed(name)
    if (found === null) throw new Error(`no scene ${name}`)
    return found
  }

  test('ledger/palette opens the palette from the menu', () => {
    expect(scene('ledger/palette')).toMatchObject({
      fixture: 'year',
      steps: [{ action: 'palette' }],
    })
  })

  test('ledger/path-picker opens the picker on From', () => {
    expect(scene('ledger/path-picker').steps).toEqual([
      { action: 'newSpend' },
      { fill: `${COMPOSER} input[name=from]`, text: '' },
      { key: 'ArrowDown' },
    ])
  })

  test('ledger/refused writes a spend, and the bridge refuses it', () => {
    expect(scene('ledger/refused').steps).toEqual([
      { action: 'newSpend' },
      { fill: `${COMPOSER} input[name=amount]`, text: '12.50' },
      { fill: `${COMPOSER} input[name=description]`, text: 'Lunch' },
      { key: 'Enter' },
    ])
  })

  test('ledger/chip-changing opens a spend, its amount being changed', () => {
    expect(scene('ledger/chip-changing').steps).toEqual([
      { key: 'Enter' },
      { click: 'button[aria-label=Amount]' },
    ])
  })

  test('accounts/adding opens the account pane on a new account', () => {
    expect(scene('accounts/adding').steps).toEqual([
      { action: 'showAccounts' },
      { action: 'addAccount' },
    ])
  })

  test('ledger/composer-typing leaves a line half written', () => {
    expect(scene('ledger/composer-typing').steps).toEqual([
      { action: 'newSpend' },
      { fill: `${COMPOSER} input[name=amount]`, text: '12.50' },
      { fill: `${COMPOSER} input[name=description]`, text: 'Lunch' },
    ])
  })
})

describe('sceneNamed', () => {
  test('a name finds its scene; another, or none, finds nothing', () => {
    expect(sceneNamed('reports/year')?.name).toBe('reports/year')
    expect(sceneNamed('nope')).toBeNull()
    expect(sceneNamed(null)).toBeNull()
  })
})
