// Money converted at a rate: both parts are whole, so no float ever touches an amount. A rate
// reads the same decimal an amount does, and stays exact through `invert` and back.

import { DECIMAL } from './money'
import { failure, type Outcome } from './outcome'

/** A rate as the two parts of a ratio in lowest terms, both above zero and inside the bound. */
export type Rate = { readonly num: bigint; readonly den: bigint }

// A rate's parts are at most 10^15: either fits an exact integer, and every real pair fits under
// it. Written once here, so the reading and its early refusals can't drift apart.
const RATE_DIGITS = 15
const RATE_LIMIT = 10n ** BigInt(RATE_DIGITS)

/** A rate read from a decimal: `"0.0091"` is 91/10000, `"2"` is 2/1, `"1e-2"` is 1/100. */
export function readRate(text: string): Outcome<Rate> {
  const match = DECIMAL.exec(text)
  if (!match) return failure('RATE_INVALID', { rate: text })
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match
  const mantissa = (whole + fraction).replace(/^0+/, '')
  // A rate is above zero, so no digits at all, zeros alone and a minus are all refused.
  if (sign === '-' || mantissa === '') return failure('RATE_INVALID', { rate: text })
  const power = Number(exponent)
  if (!Number.isSafeInteger(power)) return failure('RATE_INVALID', { rate: text })

  // Zeros past the last digit are places, not digits, so they move into the exponent.
  let kept = mantissa
  while (kept.endsWith('0')) kept = kept.slice(0, -1)
  const shift = power - fraction.length + (mantissa.length - kept.length)

  // Refused from the digits, before any BigInt: past these the parts can't come out inside the
  // bound, whatever the two are reduced by.
  if (shift < 0 && -shift > kept.length + RATE_DIGITS)
    return failure('RATE_INVALID', { rate: text })
  if (shift >= 0 && kept.length - 1 + shift > RATE_DIGITS)
    return failure('RATE_INVALID', { rate: text })

  let num = BigInt(kept)
  let den = 1n
  if (shift < 0) den = 10n ** BigInt(-shift)
  else num *= 10n ** BigInt(shift)

  const divisor = gcd(num, den)
  num /= divisor
  den /= divisor
  if (num > RATE_LIMIT || den > RATE_LIMIT) return failure('RATE_INVALID', { rate: text })
  return { ok: true, value: { num, den } }
}

/** Cents converted at a rate, rounded half away from zero. Throws unless both are exact integers. */
export function convert(cents: number, rate: Rate): number {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`not a whole number of cents: ${cents}`)
  const scaled = BigInt(cents) * rate.num
  const whole = scaled / rate.den
  const left = scaled % rate.den
  const doubled = (left < 0n ? -left : left) * 2n
  const rounded = doubled >= rate.den ? whole + (scaled < 0n ? -1n : 1n) : whole
  const answer = Number(rounded)
  if (!Number.isSafeInteger(answer)) throw new RangeError(`not a whole number of cents: ${answer}`)
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
