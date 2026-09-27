import { describe, expect, it } from 'bun:test'
import { asPreferences, mergePreferences, withCatchUpOverride } from './preferences'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('asPreferences', () => {
  it('keeps an object', () => {
    expect(asPreferences({ theme: 'graphite' })).toEqual({ theme: 'graphite' })
  })

  it('reads anything else as empty', () => {
    for (const value of [null, undefined, 'x', 3, [1, 2]]) {
      expect(asPreferences(value)).toEqual({})
    }
  })
})

describe('mergePreferences', () => {
  it('keeps the keys the patch does not name', () => {
    expect(mergePreferences({ theme: 'graphite', hidden: [1] }, { theme: 'paper' })).toEqual({
      theme: 'paper',
      hidden: [1],
    })
  })

  it('replaces a nested value whole rather than merging into it', () => {
    const current = { catchUp: { [A]: { tracked: false }, [B]: { cycleDay: 25 } } }
    expect(mergePreferences(current, { catchUp: { [A]: { tracked: true } } })).toEqual({
      catchUp: { [A]: { tracked: true } },
    })
  })

  it('stores null as null', () => {
    expect(mergePreferences({ theme: 'graphite' }, { theme: null })).toEqual({ theme: null })
  })

  it('leaves the stored object alone', () => {
    const current = { theme: 'graphite' }
    mergePreferences(current, { theme: 'paper' })
    expect(current).toEqual({ theme: 'graphite' })
  })
})

describe('withCatchUpOverride', () => {
  it('adds an account to a blob with no catch-up yet', () => {
    expect(withCatchUpOverride({ theme: 'graphite' }, A, { tracked: false })).toEqual({
      theme: 'graphite',
      catchUp: { [A]: { tracked: false } },
    })
  })

  it("replaces one account's override and keeps the others'", () => {
    const current = { catchUp: { [A]: { tracked: false }, [B]: { cycleDay: 25 } } }
    expect(withCatchUpOverride(current, A, { releaseLag: 3 })).toEqual({
      catchUp: { [A]: { releaseLag: 3 }, [B]: { cycleDay: 25 } },
    })
  })

  it("removes the account's entry when nothing is pinned", () => {
    const current = { theme: 'graphite', catchUp: { [A]: { tracked: false }, [B]: {} } }
    expect(withCatchUpOverride(current, A, {})).toEqual({
      theme: 'graphite',
      catchUp: { [B]: {} },
    })
  })

  it('leaves the blob as it is when removing from a blob with no catch-up', () => {
    const current = { theme: 'graphite' }
    expect(withCatchUpOverride(current, A, {})).toBe(current)
  })

  it('replaces a catch-up that is not an object', () => {
    expect(withCatchUpOverride({ catchUp: 'junk' }, A, { tracked: false })).toEqual({
      catchUp: { [A]: { tracked: false } },
    })
  })

  it('leaves the stored object alone', () => {
    const current = { catchUp: { [A]: { tracked: false } } }
    withCatchUpOverride(current, A, {})
    withCatchUpOverride(current, B, { tracked: true })
    expect(current).toEqual({ catchUp: { [A]: { tracked: false } } })
  })
})
