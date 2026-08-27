import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_SHELL_MODE,
  SHELL_MODES,
  accentFor,
  homeRouteFor,
  isShellMode,
  modeLabel,
  otherMode,
  resolveShellMode,
  restoreShellMode,
  tabHref,
} from './shell-mode'

describe('isShellMode', () => {
  it('accepts both modes', () => {
    expect(isShellMode('pie')).toBe(true)
    expect(isShellMode('cash')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isShellMode('group')).toBe(false)
    expect(isShellMode('')).toBe(false)
    expect(isShellMode(null)).toBe(false)
    expect(isShellMode(undefined)).toBe(false)
    expect(isShellMode(0)).toBe(false)
  })
})

describe('resolveShellMode', () => {
  it('restores a persisted mode', () => {
    expect(resolveShellMode('cash')).toBe('cash')
    expect(resolveShellMode('pie')).toBe('pie')
  })

  it('defaults to Fish Pie on a first launch', () => {
    // Every existing user has group data and no wallets yet; a fresh install
    // should land where the app has always opened.
    expect(resolveShellMode(null)).toBe('pie')
    expect(resolveShellMode(undefined)).toBe('pie')
    expect(DEFAULT_SHELL_MODE).toBe('pie')
  })

  it('degrades a corrupted or unknown stored value to the default', () => {
    // A value written by a future version that knew a third mode must not leave
    // the shell in a mode with no tabs.
    expect(resolveShellMode('wallet')).toBe('pie')
    expect(resolveShellMode('{}')).toBe('pie')
  })
})

describe('restoreShellMode', () => {
  it('applies the persisted mode when the user has not chosen yet', () => {
    expect(restoreShellMode('cash', false, 'pie')).toBe('cash')
  })

  it('keeps a deliberate choice made before the read landed', () => {
    // Tapping Cash and then being yanked back to Group a moment later, because
    // storage answered late, would look like the switch failed.
    expect(restoreShellMode('pie', true, 'cash')).toBe('cash')
    expect(restoreShellMode('cash', true, 'pie')).toBe('pie')
  })

  it('falls back to the default for an untouched shell with nothing stored', () => {
    expect(restoreShellMode(null, false, 'pie')).toBe('pie')
    expect(restoreShellMode('nonsense', false, 'cash')).toBe('pie')
  })
})

describe('otherMode', () => {
  it('toggles between the two', () => {
    expect(otherMode('pie')).toBe('cash')
    expect(otherMode('cash')).toBe('pie')
  })

  it('round-trips', () => {
    for (const mode of SHELL_MODES) {
      expect(otherMode(otherMode(mode))).toBe(mode)
    }
  })
})

describe('modeLabel', () => {
  it('labels each mode for the header switch', () => {
    expect(modeLabel('pie')).toBe('Group')
    expect(modeLabel('cash')).toBe('Cash')
  })
})

describe('tabHref', () => {
  it('shows a tab belonging to the active mode', () => {
    expect(tabHref('pie', 'pie')).toBeUndefined()
    expect(tabHref('cash', 'cash')).toBeUndefined()
  })

  it('hides a tab belonging to the inactive mode', () => {
    // null is Expo Router's "not in the bar" — the screen stays registered and
    // mounted, so switching back does not remount it.
    expect(tabHref('cash', 'pie')).toBeNull()
    expect(tabHref('pie', 'cash')).toBeNull()
  })

  it('never leaves a mode with every tab hidden', () => {
    for (const active of SHELL_MODES) {
      expect(tabHref(active, active)).toBeUndefined()
    }
  })
})

describe('homeRouteFor', () => {
  it('lands on each mode entry tab', () => {
    // A switch hides the tab you were standing on, so the shell must navigate
    // somewhere still visible.
    expect(homeRouteFor('pie')).toBe('/(app)/')
    expect(homeRouteFor('cash')).toBe('/(app)/cash-spend')
  })
})

describe('accentFor', () => {
  it('gives each mode a different accent', () => {
    // The accent is the peripheral cue for which ledger you are in — if the two
    // ever collide, that cue is gone.
    expect(accentFor('pie').accent).not.toBe(accentFor('cash').accent)
    expect(accentFor('pie').soft).not.toBe(accentFor('cash').soft)
    expect(accentFor('pie').line).not.toBe(accentFor('cash').line)
    expect(accentFor('pie').ink).not.toBe(accentFor('cash').ink)
  })

  it('returns a complete token set for both modes', () => {
    for (const mode of SHELL_MODES) {
      const a = accentFor(mode)
      for (const value of [a.accent, a.soft, a.line, a.ink]) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps Fish Pie on the app original rust accent', () => {
    // The existing tabs must not visibly change in this story.
    expect(accentFor('pie').accent).toBe('#c0651f')
  })
})
