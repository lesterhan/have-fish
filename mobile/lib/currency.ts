/**
 * Currency catalogue for the Add screen.
 *
 * There is no per-group quick-currency concept in the backend, so the quick list
 * is a static local default (handoff). The pill / sheet let the user reach the
 * full list. Symbols are display-only (the amount itself stays a bare number in
 * the hero — the pill conveys the currency).
 */

/** Quick-pick chips shown under the hero, in display order. */
export const QUICK_CURRENCIES = ['CAD', 'CZK', 'CNY', 'EUR'] as const

/** Full list shown in the Currency sheet, in display order. */
export const ALL_CURRENCIES = ['CAD', 'CZK', 'CNY', 'EUR', 'USD', 'GBP', 'JPY'] as const

export type CurrencyCode = (typeof ALL_CURRENCIES)[number]

const SYMBOLS: Record<string, string> = {
  CAD: '$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CZK: 'Kč',
}

/** Display symbol for a currency code; falls back to the code itself if unknown. */
export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code
}

/** AsyncStorage key for a group's last-used currency (shared with the old form). */
export const lastCurrencyKey = (groupId: string) => `havefish_last_currency_${groupId}`
