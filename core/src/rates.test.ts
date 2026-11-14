import { describe, expect, it } from 'vitest'
import { failure } from './outcome'
import { convert, invert, type Rate, readRate } from './rates'

/** The value of a rate that reads, as `rate('0.0091')` below says. */
function rate(text: string): Rate {
  const read = readRate(text)
  if (!read.ok) throw new Error(`readRate(${JSON.stringify(text)}) was refused`)
  return read.value
}

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

describe('convert', () => {
  it('converts 1,500 at 0.0091 to 1365 cents', () => {
    expect(convert(150000, rate('0.0091'))).toBe(1365)
  })

  it('rounds 11.375 down to 11', () => {
    expect(convert(1250, rate('0.0091'))).toBe(11)
  })

  it('rounds 2.5 up, away from zero', () => {
    expect(convert(5, rate('0.5'))).toBe(3)
  })

  it('rounds -2.5 down, away from zero', () => {
    expect(convert(-5, rate('0.5'))).toBe(-3)
  })

  it('keeps the sign of a negative amount', () => {
    expect(convert(-150000, rate('0.0091'))).toBe(-1365)
  })

  it('converts zero to zero', () => {
    expect(convert(0, rate('0.0091'))).toBe(0)
  })

  it('answers +0 when a negative rounds to zero', () => {
    expect(Object.is(convert(-54, rate('0.0091')), 0)).toBe(true)
  })

  it('converts by an inverted rate', () => {
    expect(convert(100, invert(rate('0.5')))).toBe(200)
  })

  it('converts 13.65 back to 1,500', () => {
    expect(convert(1365, invert(rate('0.0091')))).toBe(150000)
  })

  it('loses cents on the way back when the rate is below 1', () => {
    expect(convert(convert(60, rate('0.0091')), invert(rate('0.0091')))).toBe(110)
  })

  it('converts exactly by the inverse, where six places would lose cents', () => {
    expect(convert(100000000, invert(rate('0.0091')))).toBe(10989010989)
  })

  it('throws on a fraction of a cent', () => {
    expect(() => convert(1.5, rate('2'))).toThrow(RangeError)
  })

  it('throws when the answer is past exact integers', () => {
    expect(() => convert(999999999999, rate('100000'))).toThrow(RangeError)
  })
})

describe('invert', () => {
  it('swaps the two parts of a rate', () => {
    expect(invert(rate('0.0091'))).toEqual({ num: 10000n, den: 91n })
  })

  it('is its own inverse', () => {
    expect(invert(invert(rate('0.0091')))).toEqual(rate('0.0091'))
  })
})

describe('the sweeps', () => {
  it('round trips every cent by a rate of 1 or more, within 1', () => {
    const lost: string[] = []
    for (const text of ['1', '1.0001', '1.37', '2', '109.89', '150000']) {
      const r = rate(text)
      for (let c = -20000; c <= 20000; c++) {
        const back = convert(convert(c, r), invert(r))
        if (Math.abs(back - c) > 1) lost.push(`${c} at ${text} came back ${back}`)
      }
    }
    expect(lost).toEqual([])
  })

  it('round trips every cent from the other side below 1, within 1', () => {
    const lost: string[] = []
    for (const text of ['0.0091', '0.5', '0.73', '0.999999']) {
      const r = rate(text)
      for (let c = -20000; c <= 20000; c++) {
        const back = convert(convert(c, invert(r)), r)
        if (Math.abs(back - c) > 1) lost.push(`${c} at ${text} came back ${back}`)
      }
    }
    expect(lost).toEqual([])
  })

  it('keeps the sign of every cent at every rate, and answers +0', () => {
    const wrong: string[] = []
    for (const text of [
      '1',
      '1.0001',
      '1.37',
      '2',
      '109.89',
      '150000',
      '0.0091',
      '0.5',
      '0.73',
      '0.999999',
    ]) {
      const r = rate(text)
      for (let c = -20000; c <= 20000; c++) {
        // `0 - x`, never `-x`, which makes -0 of a zero answer and tells the two apart.
        if (!Object.is(convert(-c, r), 0 - convert(c, r))) wrong.push(`${c} at ${text}`)
      }
      if (!Object.is(convert(0, r), 0)) wrong.push(`zero at ${text}`)
    }
    expect(wrong).toEqual([])
  })
})
