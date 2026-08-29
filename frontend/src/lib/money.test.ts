import { describe, it, expect } from 'bun:test'
import {
  NO_RATES,
  conversionNote,
  convertBalances,
  formatCents,
  formatCentsAbs,
  otherCurrencies,
  toCents,
  type Money,
} from './money'

describe('toCents / formatCents', () => {
  it('round-trips a numeric(12,2) string', () => {
    expect(toCents('1234.56')).toBe(123456)
    expect(toCents('-1234.56')).toBe(-123456)
    expect(formatCents(123456)).toBe('1,234.56')
  })

  it('renders a negative with a true minus sign, not a hyphen', () => {
    expect(formatCents(-500)).toBe('−5.00')
  })

  it('pads the cents', () => {
    expect(formatCents(105)).toBe('1.05')
    expect(formatCents(100)).toBe('1.00')
  })

  it('is null for an unparseable amount rather than NaN', () => {
    expect(toCents('')).toBeNull()
    expect(toCents('n/a')).toBeNull()
  })

  it('does not drift on amounts that float arithmetic gets wrong', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it is exact.
    expect(toCents('0.10')! + toCents('0.20')!).toBe(30)
  })
})

describe('convertBalances', () => {
  const rates = new Map([
    ['USD', 1.4],
    ['EUR', 1.5],
  ])

  it('passes the preferred currency through untouched', () => {
    expect(
      convertBalances([{ currency: 'CAD', amount: '100.00' }], rates, 'CAD'),
    ).toEqual({ cents: 10000, missing: [], included: ['CAD'] })
  })

  it('applies the rate for a foreign currency', () => {
    expect(
      convertBalances([{ currency: 'USD', amount: '100.00' }], rates, 'CAD'),
    ).toEqual({ cents: 14000, missing: [], included: ['USD'] })
  })

  it('excludes a balance with no rate and names its currency', () => {
    const out = convertBalances(
      [
        { currency: 'CAD', amount: '100.00' },
        { currency: 'CZK', amount: '999.00' },
      ],
      rates,
      'CAD',
    )
    // The CZK leg is left out entirely rather than counted as zero or at par.
    expect(out).toEqual({ cents: 10000, missing: ['CZK'], included: ['CAD'] })
  })

  it('names each missing currency once, sorted', () => {
    const out = convertBalances(
      [
        { currency: 'CZK', amount: '1.00' },
        { currency: 'CZK', amount: '2.00' },
        { currency: 'AUD', amount: '3.00' },
      ],
      rates,
      'CAD',
    )
    expect(out.missing).toEqual(['AUD', 'CZK'])
  })

  it('treats an unparseable amount as missing rather than summing NaN', () => {
    const out = convertBalances(
      [{ currency: 'CAD', amount: 'oops' }],
      rates,
      'CAD',
    )
    expect(out.cents).toBe(0)
    expect(out.missing).toEqual(['CAD'])
  })

  it('sums an empty set to zero with nothing missing', () => {
    expect(convertBalances([], rates, 'CAD')).toEqual({
      cents: 0,
      missing: [],
      included: [],
    })
  })
})

describe('formatCentsAbs', () => {
  it('drops the sign, for a label that carries the direction in words', () => {
    expect(formatCentsAbs(-375900)).toBe('3,759.00')
    expect(formatCentsAbs(375900)).toBe('3,759.00')
  })
})

describe('otherCurrencies', () => {
  it('names the foreign currencies a total left out', () => {
    const total = convertBalances(
      [
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
        { currency: 'CZK', amount: '1.00' },
      ],
      NO_RATES,
      'CAD',
    )
    expect(otherCurrencies(total, 'CAD')).toEqual(['CZK', 'USD'])
  })

  it('does not report the preferred currency as foreign when an amount is unreadable', () => {
    const total = convertBalances([{ currency: 'CAD', amount: '' }], NO_RATES, 'CAD')
    expect(otherCurrencies(total, 'CAD')).toEqual([])
  })
})

describe('conversionNote — unconverted', () => {
  function note(balances: Money[], preferred = 'CAD') {
    return conversionNote(
      convertBalances(balances, NO_RATES, preferred),
      preferred,
      false,
    )
  }

  it('says nothing when the preferred currency is all there is', () => {
    expect(note([{ currency: 'CAD', amount: '40300.00' }])).toBeNull()
  })

  it('says nothing for an account with no balances at all', () => {
    expect(note([])).toBeNull()
  })

  it('counts the other currencies held without pricing them', () => {
    expect(
      note([
        { currency: 'CAD', amount: '40300.00' },
        { currency: 'USD', amount: '900.00' },
        { currency: 'CZK', amount: '120.00' },
      ]),
    ).toBe('+ 2 currencies held')
  })

  it('says currency, singular, for one', () => {
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
      ]),
    ).toBe('+ 1 currency held')
  })

  it('counts a currency once however many accounts hold it', () => {
    expect(
      note([
        { currency: 'USD', amount: '1.00' },
        { currency: 'USD', amount: '2.00' },
        { currency: 'USD', amount: '3.00' },
      ]),
    ).toBe('+ 1 currency held')
  })

  it('does not report the preferred currency as foreign when an amount is unreadable', () => {
    expect(note([{ currency: 'CAD', amount: '' }])).toBeNull()
  })

  it('follows the preferred currency rather than hard-coding CAD', () => {
    expect(
      note(
        [
          { currency: 'EUR', amount: '1.00' },
          { currency: 'CAD', amount: '1.00' },
        ],
        'EUR',
      ),
    ).toBe('+ 1 currency held')
  })

  it('leaves the unconverted total exact — it is a sum, not an estimate', () => {
    const total = convertBalances(
      [
        { currency: 'CAD', amount: '40300.00' },
        { currency: 'USD', amount: '900.00' },
      ],
      NO_RATES,
      'CAD',
    )
    expect(total.cents).toBe(4030000)
    expect(total.included).toEqual(['CAD'])
  })
})

describe('conversionNote — converted', () => {
  const rates = new Map([['USD', 1.4]])

  function note(balances: Money[], r = rates, preferred = 'CAD') {
    return conversionNote(convertBalances(balances, r, preferred), preferred, true)
  }

  it('says nothing when every balance made it into the total', () => {
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
      ]),
    ).toBeNull()
  })

  it('says "CAD only" when nothing but the preferred currency converted', () => {
    // The usual failure: the rate source is unreachable, so no foreign leg resolves.
    expect(
      note(
        [
          { currency: 'CAD', amount: '1.00' },
          { currency: 'CZK', amount: '1.00' },
          { currency: 'USD', amount: '1.00' },
        ],
        new Map(),
      ),
    ).toBe('CAD only')
  })

  it('does not grow with the number of excluded currencies', () => {
    // A trip through four countries must not produce a note longer than the figure.
    expect(
      note(
        [
          { currency: 'CAD', amount: '1.00' },
          { currency: 'CZK', amount: '1.00' },
          { currency: 'EUR', amount: '1.00' },
          { currency: 'HUF', amount: '1.00' },
          { currency: 'PLN', amount: '1.00' },
        ],
        new Map(),
      ),
    ).toBe('CAD only')
  })

  it('never claims "CAD only" for a total holding no CAD at all', () => {
    expect(note([{ currency: 'CZK', amount: '1.00' }], new Map())).toBe(
      'no rate available',
    )
  })

  it('never claims "CAD only" when some foreign rates did resolve', () => {
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'USD', amount: '1.00' },
        { currency: 'CZK', amount: '1.00' },
      ]),
    ).toBe('2 of 3 currencies')
  })

  it('counts a currency once when it is both summed and unusable', () => {
    // One good CAD row and one unparseable CAD row put CAD in both sets.
    expect(
      note([
        { currency: 'CAD', amount: '1.00' },
        { currency: 'CAD', amount: '' },
        { currency: 'USD', amount: '1.00' },
      ]),
    ).toBe('2 of 2 currencies')
  })

  it('follows the preferred currency rather than hard-coding CAD', () => {
    expect(
      note(
        [
          { currency: 'EUR', amount: '1.00' },
          { currency: 'CZK', amount: '1.00' },
        ],
        new Map(),
        'EUR',
      ),
    ).toBe('EUR only')
  })
})
