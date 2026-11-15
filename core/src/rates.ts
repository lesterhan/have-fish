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

  // The places the point sits left of the last digit: `"0.0091"` is four, `"1e-2"` two.
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

/** Cents converted at a rate, rounded half away from zero. Throws unless the cents and the answer
 * are whole numbers. */
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

/** The largest whole number that divides both, for a ratio in lowest terms. */
function gcd(a: bigint, b: bigint): bigint {
  while (b > 0n) [a, b] = [b, a % b]
  return a
}
