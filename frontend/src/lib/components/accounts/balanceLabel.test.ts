import { describe, it, expect } from 'bun:test'
import { balanceLabel } from './balanceLabel'

describe('balanceLabel', () => {
  it('names the direction on a liability that owes, and drops the sign', () => {
    const r = balanceLabel('liability', '-3759.46', 'CAD')
    expect(r.label).toBe('OWING · CAD')
    expect(r.display).toBe('3,759.46')
    expect(r.signInLabel).toBe(true)
  })

  it('says IN CREDIT for an overpaid card rather than OWING a negative', () => {
    const r = balanceLabel('liability', '412.08', 'CAD')
    expect(r.label).toBe('IN CREDIT · CAD')
    expect(r.display).toBe('412.08')
  })

  it('keeps the signed rendering for an asset account', () => {
    const r = balanceLabel('asset', '701.37', 'CAD')
    expect(r.label).toBe('BALANCE · CAD')
    expect(r.display).toBe('701.37')
    expect(r.signInLabel).toBe(false)
  })

  it('keeps the minus sign on a negative asset — that one IS worth noticing', () => {
    const r = balanceLabel('asset', '-3161.76', 'CZK')
    expect(r.label).toBe('BALANCE · CZK')
    expect(r.display).toBe('−3,161.76')
  })

  it('reads a settled liability as a plain balance, not as IN CREDIT', () => {
    // Zero is neither owed nor in credit; "OWING 0.00" and "IN CREDIT 0.00" both lie.
    const r = balanceLabel('liability', '0.00', 'CAD')
    expect(r.label).toBe('BALANCE · CAD')
    expect(r.display).toBe('0.00')
    expect(r.signInLabel).toBe(false)
  })

  it('falls through to BALANCE when the type could not be resolved', () => {
    expect(balanceLabel(null, '-50.00', 'EUR').label).toBe('BALANCE · EUR')
    expect(balanceLabel(undefined, '-50.00', 'EUR').label).toBe('BALANCE · EUR')
  })

  it('upper-cases the currency code', () => {
    expect(balanceLabel('asset', '10.00', 'usd').label).toBe('BALANCE · USD')
  })

  it('passes an unparseable amount straight through', () => {
    const r = balanceLabel('liability', '', 'CAD')
    expect(r.display).toBe('')
    expect(r.label).toBe('BALANCE · CAD')
  })
})
