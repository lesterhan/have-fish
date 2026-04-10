// Ordered list of supported currency codes — mirrors backend/src/currencies.ts.
// Used for datalists, selects, and client-side validation.
// Frankfurter.app currencies + NTD/BGN/HRK retained for backwards compatibility
// (existing transactions may use them; FX rate lookups won't be available for them).
export const SUPPORTED_CURRENCIES: string[] = [
  'CAD', 'EUR', 'GBP', 'USD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'HKD',
  'SGD', 'INR', 'KRW', 'MXN', 'BRL', 'ZAR', 'NOK', 'SEK', 'DKK', 'CZK',
  'PLN', 'HUF', 'RON', 'BGN', 'ISK', 'TRY', 'MYR', 'IDR', 'THB', 'PHP',
  'ILS', 'NTD', 'HRK',
]

export function isValidCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.includes(code.toUpperCase())
}

export const CURRENCY_FLAGS: Record<string, string> = {
  CAD: '🇨🇦',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  USD: '🇺🇸',
  AUD: '🇦🇺',
  NZD: '🇳🇿',
  CHF: '🇨🇭',
  JPY: '🇯🇵',
  CNY: '🇨🇳',
  HKD: '🇭🇰',
  SGD: '🇸🇬',
  INR: '🇮🇳',
  KRW: '🇰🇷',
  MXN: '🇲🇽',
  BRL: '🇧🇷',
  ZAR: '🇿🇦',
  NOK: '🇳🇴',
  SEK: '🇸🇪',
  DKK: '🇩🇰',
  CZK: '🇨🇿',
  PLN: '🇵🇱',
  HUF: '🇭🇺',
  RON: '🇷🇴',
  BGN: '🇧🇬',
  ISK: '🇮🇸',
  TRY: '🇹🇷',
  MYR: '🇲🇾',
  IDR: '🇮🇩',
  THB: '🇹🇭',
  PHP: '🇵🇭',
  ILS: '🇮🇱',
  NTD: '🇹🇼',
  HRK: '🇭🇷',
}

export function currencyFlag(currency: string): string {
  return CURRENCY_FLAGS[currency] ?? ''
}

/** Compact amount for tight spaces: ≥10 000 → "12.3K", otherwise 2 dp. Preserves sign. */
export function formatCompact(amount: string): string {
  const n = parseFloat(amount)
  if (isNaN(n)) return amount
  const abs = Math.abs(n)
  const formatted =
    abs >= 10000 ? `${(abs / 1000).toFixed(1)}K` : abs.toFixed(2)
  return n < 0 ? `-${formatted}` : formatted
}
