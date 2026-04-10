// Supported currency codes — mirrors the CURRENCY_FLAGS map in the frontend.
// This is the set of currencies the app accepts for postings, settings, and FX rate lookups.
// All writes that include a currency code are validated against this set.
// Mirrors SUPPORTED_CURRENCIES in frontend/src/lib/currency.ts.
// Frankfurter.app currencies + NTD/BGN/HRK retained for backwards compatibility.
export const SUPPORTED_CURRENCIES = new Set([
  'CAD', 'EUR', 'GBP', 'USD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'HKD',
  'SGD', 'INR', 'KRW', 'MXN', 'BRL', 'ZAR', 'NOK', 'SEK', 'DKK', 'CZK',
  'PLN', 'HUF', 'RON', 'BGN', 'ISK', 'TRY', 'MYR', 'IDR', 'THB', 'PHP',
  'ILS', 'NTD', 'HRK',
])

export function isValidCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.has(code.toUpperCase())
}
