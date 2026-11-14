import { describe, expect, it } from 'vitest'
import { failure } from './outcome'
import { readRate } from './rates'

const refused = (text: string) =>
  expect(readRate(text)).toMatchObject({ ok: false, failure: { code: 'RATE_INVALID' } })

describe('readRate', () => {
  it('reads 0.0091 as 91/10000', () => {
    expect(readRate('0.0091')).toEqual({ ok: true, value: { num: 91n, den: 10000n } })
  })

  it('reads a whole number as itself over one', () => {
    expect(readRate('2')).toEqual({ ok: true, value: { num: 2n, den: 1n } })
  })

  it('reads 0.50 in lowest terms, as 0.5 is', () => {
    expect(readRate('0.50')).toEqual({ ok: true, value: { num: 1n, den: 2n } })
    expect(readRate('0.5')).toEqual(readRate('0.50'))
  })

  it('reads spaces and an exponent, as money.parse does', () => {
    expect(readRate(' 1e-2 ')).toEqual({ ok: true, value: { num: 1n, den: 100n } })
  })

  it('reads six places as they come from the current app', () => {
    expect(readRate('109.890110')).toEqual({ ok: true, value: { num: 10989011n, den: 100000n } })
  })

  it('refuses an empty string', () => {
    refused('')
  })

  it('refuses text that is not a number', () => {
    refused('abc')
  })

  it('refuses zero', () => {
    refused('0')
  })

  it('refuses a negative rate', () => {
    refused('-0.5')
  })

  it('refuses nothing but zeros', () => {
    refused('0.000')
  })

  it('refuses a comma for the point', () => {
    refused('1,5')
  })

  it('says which text it refused', () => {
    expect(readRate('abc')).toEqual(failure('RATE_INVALID', { rate: 'abc' }))
  })

  it('reads the largest rate the bound allows', () => {
    expect(readRate('1e15')).toEqual({ ok: true, value: { num: 1000000000000000n, den: 1n } })
  })

  it('reads the smallest rate the bound allows', () => {
    expect(readRate('1e-15')).toEqual({ ok: true, value: { num: 1n, den: 1000000000000000n } })
  })

  it('refuses a rate above the bound', () => {
    refused('1e16')
  })

  it('refuses a rate below the bound', () => {
    refused('1e-16')
  })

  it('refuses sixteen significant digits past the bound', () => {
    refused('3.000000000000001')
  })

  it('ignores zeros past the last digit', () => {
    expect(readRate('0.50000000000000000000')).toEqual({ ok: true, value: { num: 1n, den: 2n } })
  })

  it('refuses a huge negative exponent from the text, in under 50 ms', () => {
    const began = performance.now()
    refused('1e-99999999')
    expect(performance.now() - began).toBeLessThan(50)
  })

  it('refuses a huge exponent from the text, in under 50 ms', () => {
    const began = performance.now()
    refused('1e99999999')
    expect(performance.now() - began).toBeLessThan(50)
  })
})
