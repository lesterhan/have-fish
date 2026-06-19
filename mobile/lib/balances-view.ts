/**
 * Pure, RN-free presentation helpers for the Balances tab.
 *
 * The backend (`fetchBalances`) already computes per-currency net positions and
 * the minimal transfer set — these helpers only shape that data for display:
 * which currency cards to show, in what order, how to format a signed member
 * net, and the currency symbol shown in a card header. Kept DOM/RN-free so the
 * `bun test` suite can cover them without a renderer (Companion convention).
 *
 * Amounts arrive as `numeric(12,2)` strings; we parse only to compare/format and
 * never mutate the source values.
 */
import type { CurrencyBalance } from './api'

/** Real Unicode minus sign (U+2212), not the ASCII hyphen — matches the design. */
export const MINUS = '−'

/**
 * Currency symbols shown faint in a card header. Unknown codes render no symbol
 * (the code itself is always shown), so this map only needs the common set.
 */
const SYMBOLS: Record<string, string> = {
  CAD: '$',
  USD: '$',
  AUD: '$',
  NZD: '$',
  HKD: '$',
  SGD: '$',
  MXN: '$',
  BRL: 'R$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CHF: 'Fr',
  INR: '₹',
  KRW: '₩',
  ZAR: 'R',
  NOK: 'kr',
  SEK: 'kr',
  DKK: 'kr',
  ISK: 'kr',
  CZK: 'Kč',
  PLN: 'zł',
  HUF: 'Ft',
  RON: 'lei',
  BGN: 'лв',
  TRY: '₺',
  MYR: 'RM',
  IDR: 'Rp',
  THB: '฿',
  PHP: '₱',
  ILS: '₪',
  NTD: 'NT$',
  HRK: 'kn',
}

/** Currency symbol for a code, or empty string when unknown. */
export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? ''
}

/** A net/transfer of this magnitude or smaller is treated as zero (rounding). */
const EPSILON = 0.005

/** Format a non-negative magnitude `1840.3` → `1,840.30` (always 2dp). */
export function formatAmount(amount: string | number): string {
  const n = Math.abs(typeof amount === 'number' ? amount : parseFloat(amount))
  const fixed = (Number.isFinite(n) ? n : 0).toFixed(2)
  const dot = fixed.indexOf('.')
  const intPart = fixed.slice(0, dot)
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${withSeparators}${fixed.slice(dot)}`
}

export interface SignedAmount {
  /** Display text with a leading `+` or real minus glyph, e.g. `+1,840.30`. */
  text: string
  /** True when the value is ≥ 0 (paint green); false paints red. */
  positive: boolean
}

/** Format a signed net position for a member row: `+1,840.30` / `−1,840.30`. */
export function formatSigned(amount: string | number): SignedAmount {
  const n = typeof amount === 'number' ? amount : parseFloat(amount)
  const positive = !(n < 0) // 0 and NaN paint as positive
  return { text: `${positive ? '+' : MINUS}${formatAmount(amount)}`, positive }
}

/** Largest absolute net position in a currency card — drives sort order. */
export function balanceMagnitude(balance: CurrencyBalance): number {
  return balance.netPositions.reduce((max, p) => {
    const v = Math.abs(parseFloat(p.amount))
    return Number.isFinite(v) && v > max ? v : max
  }, 0)
}

/** True when every member nets ~zero in this currency (nothing owed). */
export function isZeroNet(balance: CurrencyBalance): boolean {
  return balance.netPositions.every((p) => Math.abs(parseFloat(p.amount)) < EPSILON)
}

/**
 * Cards worth showing: drop any currency that nets to zero, then sort by
 * magnitude (largest debt first) so the most significant balance leads.
 */
export function visibleBalances(balances: CurrencyBalance[]): CurrencyBalance[] {
  return balances
    .filter((b) => !isZeroNet(b))
    .sort((a, b) => balanceMagnitude(b) - balanceMagnitude(a))
}

/** True when there is nothing to settle in any currency (🎉 state). */
export function isAllSettled(balances: CurrencyBalance[]): boolean {
  return visibleBalances(balances).length === 0
}
