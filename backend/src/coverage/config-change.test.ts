import { describe, expect, it } from 'bun:test'
import { applyConfigChange, configChangeFrom, isComputable } from './horizon'

// Pinning an account's catch-up config by hand, without the database. `config.test.ts`
// covers the service and the route around it.

describe('configChangeFrom', () => {
  it('separates fields set from fields cleared', () => {
    expect(configChangeFrom({ exportMode: 'cycle', cycleDay: 25, releaseLag: null })).toEqual({
      set: { exportMode: 'cycle', cycleDay: 25 },
      cleared: new Set(['releaseLag']),
    })
  })

  it('keeps a false or a zero as a value, not a clear', () => {
    expect(configChangeFrom({ tracked: false, releaseLag: 0 })).toEqual({
      set: { tracked: false, releaseLag: 0 },
      cleared: new Set(),
    })
  })

  it('is null when the body names no field', () => {
    expect(configChangeFrom({})).toBeNull()
  })
})

describe('applyConfigChange', () => {
  it('lays new pins over the stored ones and drops the cleared', () => {
    expect(
      applyConfigChange(
        { exportMode: 'cycle', cycleDay: 25, releaseLag: 3 },
        { set: { cycleDay: 18 }, cleared: new Set(['releaseLag']) },
      ),
    ).toEqual({ exportMode: 'cycle', cycleDay: 18 })
  })

  it('leaves the stored pins untouched', () => {
    const stored = { tracked: true }
    applyConfigChange(stored, { set: {}, cleared: new Set(['tracked']) })
    expect(stored).toEqual({ tracked: true })
  })
})

describe('isComputable', () => {
  it('refuses only a cycle account with no cycle day', () => {
    const base = { releaseLag: 0, tracked: true }
    expect(isComputable({ ...base, exportMode: 'cycle', cycleDay: null })).toBe(false)
    expect(isComputable({ ...base, exportMode: 'cycle', cycleDay: 25 })).toBe(true)
    expect(isComputable({ ...base, exportMode: 'range', cycleDay: null })).toBe(true)
  })
})
