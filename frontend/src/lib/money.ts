/**
 * Money arithmetic, formatting, and multi-currency conversion.
 *
 * Amounts arrive from the API as `numeric(12,2)` strings and are summed in integer cents,
 * because float addition of decimal money drifts: `0.1 + 0.2` is `0.30000000000000004`.
 * Anything that needs to add two amounts should come through here rather than reaching for
 * `parseFloat`.
 */

/** An amount in a currency, exactly as stored. */
export interface Money {
  currency: string
  amount: string
}

/**
 * A `numeric(12,2)` string as integer cents, or null when it is not a usable number.
 *
 * The blank check is not redundant: `Number('')` is 0, so an empty amount would otherwise
 * be summed as a real zero instead of being reported as unusable.
 */
export function toCents(amount: string): number | null {
  if (amount.trim() === '') return null
  const n = Number(amount)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/**
 * The app's one way of writing an amount: thousands separators, two decimals, and a true
 * minus sign (U+2212) rather than a hyphen, which at small sizes reads as a dash.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '−' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${new Intl.NumberFormat('en-CA').format(whole)}.${frac}`
}

/** The same figure without its sign — for a label that carries the direction in words. */
export function formatCentsAbs(cents: number): string {
  return formatCents(Math.abs(cents))
}

// ── Conversion ──────────────────────────────────────────────

/** Currency → rate into the preferred currency. The preferred currency itself is implicit. */
export type Rates = ReadonlyMap<string, number>

/** No rates at all — what a surface reads before anyone asks it to convert. */
export const NO_RATES: Rates = new Map()

export interface Converted {
  /** Total in the preferred currency, in cents, over the balances that could be converted. */
  cents: number
  /** Currencies that had no rate, so are missing from `cents`. Sorted, deduplicated. */
  missing: string[]
  /** Currencies actually folded into `cents`. Sorted, deduplicated. */
  included: string[]
}

/**
 * Convert and sum. A balance whose rate is unavailable is left out of the total and named
 * in `missing` — the caller says so rather than quietly under-reporting, which is the one
 * failure mode that would make every number on a page untrustworthy.
 *
 * Passing `NO_RATES` is therefore not a degenerate case but a useful one: the result is the
 * preferred-currency balance alone, exact and needing no rate lookup, with every other
 * currency named in `missing`.
 */
export function convertBalances(
  balances: readonly Money[],
  rates: Rates,
  preferred: string,
): Converted {
  let cents = 0
  const missing = new Set<string>()
  const included = new Set<string>()

  for (const b of balances) {
    const amount = toCents(b.amount)
    if (amount === null) {
      missing.add(b.currency)
      continue
    }
    if (b.currency === preferred) {
      cents += amount
      included.add(b.currency)
      continue
    }
    const rate = rates.get(b.currency)
    if (rate === undefined) {
      missing.add(b.currency)
      continue
    }
    cents += Math.round(amount * rate)
    included.add(b.currency)
  }

  return {
    cents,
    missing: [...missing].sort(),
    included: [...included].sort(),
  }
}

/**
 * Currencies a total leaves out that are not the preferred one.
 *
 * With `NO_RATES` this is exactly "the other currencies held here". The preferred-currency
 * filter matters only for the pathological case of an unreadable amount in the preferred
 * currency, which should not be reported as a foreign one.
 */
export function otherCurrencies(total: Converted, preferred: string): string[] {
  return total.missing.filter((c) => c !== preferred)
}

/**
 * A short phrase for what a total leaves out, or null when it leaves out nothing.
 *
 * Two modes, because an unconverted figure and a converted one are incomplete in different
 * ways. Unconverted, the figure is the preferred currency alone — complete on its own terms —
 * and the note only has to say that other money exists without pretending to price it.
 * Converted, the figure tried to cover everything, so the note reports how much of it the
 * rates actually reached.
 *
 * Neither mode ever lists currencies: a trip through four countries would make the note longer
 * than the figure it annotates. The full list belongs in a tooltip.
 *
 * The two edge cases in the converted branch are what stop `"CAD only"` from lying — a total
 * with nothing in it at all (a group holding only CZK, with no CZK rate) is not "CAD only",
 * and neither is one where some foreign rates resolved and others did not.
 */
export function conversionNote(
  total: Converted,
  preferred: string,
  converted: boolean,
): string | null {
  if (total.missing.length === 0) return null

  if (!converted) {
    const others = otherCurrencies(total, preferred)
    if (others.length === 0) return null
    return `+ ${others.length} ${others.length === 1 ? 'currency' : 'currencies'} held`
  }

  const { missing, included } = total
  if (included.length === 0) return 'no rate available'
  if (included.length === 1 && included[0] === preferred) return `${preferred} only`
  const distinct = new Set([...included, ...missing]).size
  return `${included.length} of ${distinct} currencies`
}
