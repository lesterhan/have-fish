// Money converted at a rate: both parts are whole, so no float ever touches an amount. A rate
// reads the same decimal an amount does, and stays exact through `invert` and back.

import { DECIMAL } from './money'
import { failure, type Outcome } from './outcome'

/** A rate as the two parts of a ratio in lowest terms, both above zero and inside the bound. */
export type Rate = { readonly num: bigint; readonly den: bigint }

// A rate's parts are at most 10^15: either fits an exact integer, and every real pair is under
// it. Written once here, so the reading and its early refusals can't drift apart.
const RATE_DIGITS = 15
const RATE_MAX = 10n ** BigInt(RATE_DIGITS)

/** A rate read from a decimal: `"0.0091"` is 91/10000, `"2"` is 2/1, `"1e-2"` is 1/100. */
export function readRate(text: string): Outcome<Rate> {
  const refused = failure('RATE_INVALID', { rate: text })
  const match = DECIMAL.exec(text)
  if (!match) return refused
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match
  const mantissa = (whole + fraction).replace(/^0+/, '')
  // A rate is above zero, so no digits at all, zeros alone and a minus are all refused.
  if (sign === '-' || mantissa === '') return refused

  // The power of ten the digits are scaled by: `"0.0091"` is -4, `"1e-2"` -2, `"1e3"` 3.
  const shift = Number(exponent) - fraction.length

  // Refused from the digits, before any BigInt: past these the parts can't come out inside the
  // bound, whatever the two are reduced by.
  if (shift < 0 && -shift > mantissa.length + RATE_DIGITS) return refused
  if (shift >= 0 && mantissa.length - 1 + shift > RATE_DIGITS) return refused

  let num = BigInt(mantissa)
  let den = 1n
  if (shift < 0) den = 10n ** BigInt(-shift)
  else num *= 10n ** BigInt(shift)

  const divisor = gcd(num, den)
  num /= divisor
  den /= divisor
  if (num > RATE_MAX || den > RATE_MAX) return refused
  return { ok: true, value: { num, den } }
}

/**
 * Cents converted at a rate, rounded half away from zero. Throws unless the cents and the answer
 * are whole numbers.
 */
export function convert(cents: number, rate: Rate): number {
  if (!Number.isSafeInteger(cents)) throw new RangeError('cents are not a whole number')
  const scaled = BigInt(cents) * rate.num
  const whole = scaled / rate.den
  const left = scaled % rate.den
  const doubled = (left < 0n ? -left : left) * 2n
  const rounded = doubled >= rate.den ? whole + (scaled < 0n ? -1n : 1n) : whole
  const answer = Number(rounded)
  if (!Number.isSafeInteger(answer)) throw new RangeError('the answer is past exact integers')
  return answer
}

/** The rate the other way: num and den swapped, so the conversion back is exact. */
export function invert(rate: Rate): Rate {
  return { num: rate.den, den: rate.num }
}

/** The rate that turns `paid` into `got`, both whole cents above zero: 3620 into 400000. */
export function ratio(paid: number, got: number): Rate {
  const [num, den] = [BigInt(got), BigInt(paid)]
  const divisor = gcd(num, den)
  return { num: num / divisor, den: den / divisor }
}

/** A rate to `digits` significant figures, half up: `110.5`, `0.6667`, `1235000`. */
export function significant(rate: Rate, digits: number): string {
  const { num, den } = rate
  // The power of ten the rate's first digit stands at: 2 for 110.5, -1 for 0.6667.
  let power = String(num).length - String(den).length
  if (num * ten(-power) < den * ten(power)) power -= 1
  const scale = digits - 1 - power
  const [top, bottom] = [num * ten(scale), den * ten(-scale)]
  let figures = top / bottom
  if ((top % bottom) * 2n >= bottom) figures += 1n
  // The point is placed by the scale, so 9.9996 rounding up to 10.000 carries on its own.
  if (scale <= 0) return String(figures * ten(-scale))
  const text = String(figures).padStart(scale + 1, '0')
  const fraction = text.slice(-scale).replace(/0+$/, '')
  const whole = text.slice(0, -scale)
  return fraction === '' ? whole : `${whole}.${fraction}`
}

/** Ten to a power at or above zero, else one: the half of a scale that multiplies. */
const ten = (power: number): bigint => (power > 0 ? 10n ** BigInt(power) : 1n)

/** The largest whole number that divides both, for a ratio in lowest terms. */
function gcd(a: bigint, b: bigint): bigint {
  while (b > 0n) [a, b] = [b, a % b]
  return a
}
