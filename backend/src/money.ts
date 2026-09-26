// Money as the ledger stores it: a decimal string with two places, like `numeric(12,2)` holds
// it. Amounts come in and go out as those strings; the arithmetic in between happens in
// integer cents, so 0.10 + 0.20 is 0.30 and not 0.30000000000000004.
//
// A `number` holds every whole number up to 2^53 exactly, which is 90 trillion in cents, so
// no BigInt is needed. Anything that would leave that range throws rather than rounding.

/** The largest magnitude a posting's `numeric(12,2)` column can hold, in cents, plus one. */
const LIMIT_CENTS = 10 ** 12

// What Postgres reads as a number in a numeric column: optional whitespace and sign, digits
// with an optional point (`5`, `5.`, `.5`, `5.25`), and an optional exponent (`1e3`). Postgres
// also reads `NaN` and `Infinity`; this does not, because neither is an amount of money.
const DECIMAL = /^[ \t\n\r\f\v]*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?[ \t\n\r\f\v]*$/

/**
 * The amount in cents, rounded to two places the way `numeric(12,2)` rounds it on write
 * (half away from zero, so `12.345` is 1235 and `-12.345` is -1235). Null for anything that
 * is not a number, and for anything that column could not store.
 *
 * Rounding exactly as the database does is what lets a check on the cents be a check on
 * what will be written.
 */
export function parse(amount: string): number | null {
  const match = DECIMAL.exec(amount)
  if (!match) return null
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match
  if (whole === '' && fraction === '') return null

  // Every digit in one string, and where the point falls in it once the amount is scaled to
  // cents: two places to the right, plus whatever the exponent says.
  let digits = whole + fraction
  let point = whole.length + 2 + Number(exponent)
  const leading = /^0*/.exec(digits)?.[0].length ?? 0
  digits = digits.slice(leading)
  point -= leading
  if (digits === '') return 0
  if (point > String(LIMIT_CENTS).length) return null

  const kept = point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0')
  const next = point < 0 ? '0' : (digits[point] ?? '0')
  const cents = Number(kept) + (next >= '5' ? 1 : 0)
  if (cents >= LIMIT_CENTS) return null
  // `+ 0` turns -0 into 0, so a rounded-away amount is zero whichever sign it came with.
  return (sign === '-' ? -cents : cents) + 0
}

/** Cents as the two-place string the ledger stores: `-1235` is `'-12.35'`, `0` is `'0.00'`. */
export function format(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`not a whole number of cents: ${cents}`)
  const digits = String(Math.abs(cents)).padStart(3, '0')
  const sign = cents < 0 ? '-' : ''
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

// Amounts handed to the arithmetic below have already been accepted: they came from a column
// or through `parse` at the edge. One that doesn't parse is a bug in the caller, so it throws.
function cents(amount: string): number {
  const value = parse(amount)
  if (value === null) throw new RangeError(`not an amount: ${JSON.stringify(amount)}`)
  return value
}

export function add(a: string, b: string): string {
  return format(cents(a) + cents(b))
}

export function sub(a: string, b: string): string {
  return format(cents(a) - cents(b))
}

export function neg(a: string): string {
  return format(-cents(a) + 0)
}

/** The total of any number of amounts; `'0.00'` for none. */
export function sum(amounts: Iterable<string>): string {
  let total = 0
  for (const amount of amounts) total += cents(amount)
  return format(total)
}

/**
 * The amount divided in proportion to the weights, one share per weight, adding up to the
 * amount exactly.
 *
 * Each share is rounded to the cent (half away from zero), and whatever that rounding leaves
 * over, never more than a cent per share, goes to the share at `remainderTo`. That is the rule
 * the Fish Pie split has always used, with the payer as the one who absorbs it; here it is in
 * whole cents, so the shares can't drift from the total.
 */
export function splitByWeights(
  amount: string,
  weights: readonly number[],
  remainderTo = 0,
): string[] {
  if (weights.length === 0) throw new RangeError('cannot split among no one')
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError(`weights must be finite and not negative: ${weights.join(', ')}`)
  }
  if (!Number.isInteger(remainderTo) || remainderTo < 0 || remainderTo >= weights.length) {
    throw new RangeError(`no share at ${remainderTo} to take the remainder`)
  }
  const total = weights.reduce((s, w) => s + w, 0)
  if (total === 0) throw new RangeError('weights add up to zero')

  const whole = cents(amount)
  const shares = weights.map((w) => {
    const exact = (Math.abs(whole) * w) / total
    return Math.sign(whole) * Math.round(exact) + 0
  })
  const left = whole - shares.reduce((s, c) => s + c, 0)
  shares[remainderTo] = (shares[remainderTo] ?? 0) + left
  return shares.map(format)
}
