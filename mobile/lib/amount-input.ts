/**
 * Numpad amount input model — pure string transforms.
 *
 * The Add screen drives the amount entirely from a custom numpad (no OS
 * keyboard), so the amount is a hand-managed **string** end-to-end, matching the
 * `numeric(12,2)` convention. We store exactly what was typed (`"12."` stays
 * `"12."`) and never parse to a float until the final `toFixed(2)` for the API
 * body. Display formatting (thousands separators) is a render-time transform —
 * the raw typed string keeps no separators.
 */

/** Max raw characters accepted, to keep the hero from overflowing. */
const MAX_LENGTH = 10
/** Decimal places allowed after the dot. */
const MAX_DECIMALS = 2

/** Decimal portion typed so far (excludes the dot). Empty if no dot yet. */
function decimalsTyped(amount: string): string {
  const dot = amount.indexOf('.')
  return dot === -1 ? '' : amount.slice(dot + 1)
}

/**
 * Append a single digit (`"0"`–`"9"`).
 * - Replaces a lone leading `"0"` (so `0` then `5` → `5`, not `05`).
 * - Ignores the digit once two decimals are already typed.
 * - Ignores the digit at the length cap.
 */
export function appendDigit(amount: string, digit: string): string {
  if (amount.includes('.') && decimalsTyped(amount).length >= MAX_DECIMALS) return amount
  if (amount.length >= MAX_LENGTH) return amount
  // Replace a lone leading zero (but keep "0." so cents can be typed).
  if (amount === '0') return digit
  return amount + digit
}

/**
 * Append the decimal point.
 * - Adds at most one dot.
 * - An empty amount becomes `"0."` so the leading zero is explicit.
 */
export function appendDot(amount: string): string {
  if (amount.includes('.')) return amount
  if (amount === '') return '0.'
  if (amount.length >= MAX_LENGTH) return amount
  return amount + '.'
}

/** Drop the last character. Backspacing to empty leaves `""` (renders `0.00`). */
export function backspace(amount: string): string {
  return amount.slice(0, -1)
}

/** True when the typed amount parses to a value greater than zero. */
export function isPositiveAmount(amount: string): boolean {
  const n = parseFloat(amount)
  return Number.isFinite(n) && n > 0
}

/**
 * Render the raw typed string for the hero display.
 * - Empty → `"0.00"` (the call site paints it faint).
 * - The integer part gets thousands separators.
 * - The decimal part is shown exactly as typed: `"12."` → `"12."`,
 *   `"1234.5"` → `"1,234.5"`.
 */
export function formatAmountDisplay(amount: string): string {
  if (amount === '') return '0.00'
  const dot = amount.indexOf('.')
  const intPart = dot === -1 ? amount : amount.slice(0, dot)
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (dot === -1) return withSeparators
  return `${withSeparators}.${amount.slice(dot + 1)}`
}
