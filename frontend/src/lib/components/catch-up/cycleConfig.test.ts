import { describe, it, expect } from 'bun:test'
import {
  AUTOMATIC,
  cycleDayLabel,
  exportModeLabel,
  ordinal,
  planCycleCommit,
  releaseLagLabel,
  toDayChoice,
} from './cycleConfig'

describe('ordinal', () => {
  it('handles the three irregular suffixes', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
  })

  it('says 11th, 12th, 13th — not 11st, 12nd, 13rd', () => {
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
  })

  it('picks the suffix back up in the twenties and thirties', () => {
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(23)).toBe('23rd')
    expect(ordinal(31)).toBe('31st')
  })
})

describe('toDayChoice', () => {
  it('reads a numeric select value back as a number', () => {
    expect(toDayChoice('15')).toBe(15)
    expect(toDayChoice('31')).toBe(31)
  })

  it('keeps a zero lag as a real zero, not as automatic', () => {
    // The trap this whole sentinel exists for: `Number('0')` is falsy, so any truthiness
    // check here would silently clear the override instead of pinning same-day release.
    expect(toDayChoice('0')).toBe(0)
    expect(toDayChoice('0')).not.toBe(AUTOMATIC)
  })

  it('reads the empty value as automatic', () => {
    expect(toDayChoice('')).toBe(AUTOMATIC)
  })

  it('falls back to automatic rather than passing NaN along', () => {
    expect(toDayChoice('banana')).toBe(AUTOMATIC)
    expect(toDayChoice('1.5')).toBe(AUTOMATIC)
  })
})

describe('the automatic option labels', () => {
  it('names the day inference picked', () => {
    expect(cycleDayLabel(25)).toBe('Automatic (25th)')
  })

  it('says so plainly when inference found no rhythm', () => {
    expect(cycleDayLabel(null)).toBe('Automatic (none found)')
    expect(cycleDayLabel(undefined)).toBe('Automatic (none found)')
  })

  it('agrees with itself on a single day of lag', () => {
    expect(releaseLagLabel(0)).toBe('Automatic (same day)')
    expect(releaseLagLabel(1)).toBe('Automatic (1 day)')
    expect(releaseLagLabel(3)).toBe('Automatic (3 days)')
  })

  it('falls back to the default lag when nothing was inferred', () => {
    // DEFAULT_CONFIG.releaseLag is 0, so automatic really does mean same-day here.
    expect(releaseLagLabel(null)).toBe('Automatic (same day)')
  })

  it('spells the inferred export mode out rather than echoing the enum', () => {
    expect(exportModeLabel('cycle')).toBe('Automatic (statement cycle)')
    expect(exportModeLabel('range')).toBe('Automatic (any date range)')
    // No rhythm found: DEFAULT_CONFIG.exportMode is 'range', and saying so is the honest
    // version of "we are not holding this account to a statement schedule".
    expect(exportModeLabel(null)).toBe('Automatic (any date range)')
  })
})

describe('planCycleCommit', () => {
  const noInference = { mode: null, day: null }

  it('clears both fields when the user goes back to automatic', () => {
    const plan = planCycleCommit(
      { mode: AUTOMATIC, day: AUTOMATIC },
      { mode: 'cycle', day: 25 },
    )

    expect(plan).toEqual({
      status: 'send',
      patch: { exportMode: null, cycleDay: null },
    })
  })

  it('sends both together when a cycle and a day are chosen by hand', () => {
    const plan = planCycleCommit({ mode: 'cycle', day: 15 }, noInference)

    expect(plan).toEqual({
      status: 'send',
      patch: { exportMode: 'cycle', cycleDay: 15 },
    })
  })

  it('refuses to send a cycle with no day anywhere to be found', () => {
    // The route rejects this combination outright, so firing the PATCH would earn a 400
    // and tell the user nothing they could act on.
    const plan = planCycleCommit({ mode: 'cycle', day: AUTOMATIC }, noInference)

    expect(plan.status).toBe('incomplete')
    expect(plan).toMatchObject({ reason: expect.stringContaining('day') })
  })

  it('lets a cycle through on an inferred day alone', () => {
    const plan = planCycleCommit(
      { mode: 'cycle', day: AUTOMATIC },
      { mode: 'cycle', day: 25 },
    )

    expect(plan).toEqual({
      status: 'send',
      patch: { exportMode: 'cycle', cycleDay: null },
    })
  })

  it('lets range through with no day at all — range has no use for one', () => {
    const plan = planCycleCommit({ mode: 'range', day: AUTOMATIC }, noInference)

    expect(plan).toEqual({
      status: 'send',
      patch: { exportMode: 'range', cycleDay: null },
    })
  })

  it('treats automatic-that-infers-to-cycle the same as picking cycle', () => {
    // Inference found a rhythm and the user has not overridden it, so the effective mode is
    // 'cycle' and the same day requirement applies.
    const plan = planCycleCommit(
      { mode: AUTOMATIC, day: AUTOMATIC },
      { mode: 'cycle', day: null },
    )

    expect(plan.status).toBe('incomplete')
  })

  it('falls back to range when nothing is chosen and nothing is inferred', () => {
    const plan = planCycleCommit(
      { mode: AUTOMATIC, day: AUTOMATIC },
      noInference,
    )

    expect(plan).toEqual({
      status: 'send',
      patch: { exportMode: null, cycleDay: null },
    })
  })

  it('keeps a pinned day when the mode goes back to automatic', () => {
    const plan = planCycleCommit({ mode: AUTOMATIC, day: 8 }, noInference)

    expect(plan).toEqual({
      status: 'send',
      patch: { exportMode: null, cycleDay: 8 },
    })
  })

  it('distinguishes a pinned zero lag from automatic', () => {
    // Not planCycleCommit's job, but the same trap: releaseLag 0 is a real value and must
    // never be conflated with "no override". AUTOMATIC is the empty string precisely so
    // that a falsy number cannot be mistaken for it.
    expect(AUTOMATIC).toBe('')
    expect(0 === (AUTOMATIC as unknown as number)).toBe(false)
  })
})
