import { describe, expect, test } from 'vitest'
import { PLACES } from '../renderer/places'
import { SCENES, sceneNamed } from './scenes'

describe('SCENES', () => {
  test('the eight to start, each once', () => {
    expect(SCENES.map((scene) => scene.name).sort()).toEqual([
      'accounts/year',
      'ledger/compact',
      'ledger/empty',
      'ledger/spend-open',
      'ledger/starter',
      'ledger/year',
      'reports/category-open',
      'reports/year',
    ])
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

describe('sceneNamed', () => {
  test('a name finds its scene; another, or none, finds nothing', () => {
    expect(sceneNamed('reports/year')?.name).toBe('reports/year')
    expect(sceneNamed('nope')).toBeNull()
    expect(sceneNamed(null)).toBeNull()
  })
})
