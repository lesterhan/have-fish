// Money in a document: a decimal string with two places, like `-12.50`. Amounts come in and
// go out as those strings; the arithmetic in between happens in integer cents.
//

/**
 * One cent past the largest amount a posting can carry (`9999999999.99`), in cents. It is the
 * current app's limit, kept so that its ledgers carry over as they are.
 */
const LIMIT_CENTS = 10 ** 12

// What `parse` accepts: optional whitespace and sign, digits with an optional point (`5`,
// `5.`, `.5`, `5.25`), and an optional exponent (`1e3`). It is lenient so that any way of
// writing a number reads; canonical form then rewrites it, so `1.25e1` reads back as `12.50`.
const DECIMAL = /^[ \t\n\r\f\v]*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?[ \t\n\r\f\v]*$/

/**
 * The amount in cents, rounded half away from zero: `12.345` is 1235 and `-12.345` is -1235.
 * Null for anything that is not a number, and for anything past `LIMIT_CENTS`.
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

/** Cents as the canonical two-place string: `-1235` is `'-12.35'`, `0` is `'0.00'`. */
export function format(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`not a whole number of cents: ${cents}`)
  const digits = String(Math.abs(cents)).padStart(3, '0')
  const sign = cents < 0 ? '-' : ''
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

// Amounts handed to the arithmetic below have already been accepted through `parse` at the
// edge. One that doesn't parse is a bug in the caller, so it throws.

/** An accepted amount in cents, for sums kept as numbers. Throws on one that isn't an amount. */
export function cents(amount: string): number {
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
