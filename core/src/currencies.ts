// The currencies a posting can carry. The current app's list as it stands, so its ledgers carry
// over: the currencies its rate source quotes, plus NTD, BGN and HRK, which older entries use.
export const SUPPORTED_CURRENCIES = new Set([
  'CAD',
  'EUR',
  'GBP',
  'USD',
  'AUD',
  'NZD',
  'CHF',
  'JPY',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'KRW',
  'MXN',
  'BRL',
  'ZAR',
  'NOK',
  'SEK',
  'DKK',
  'CZK',
  'PLN',
  'HUF',
  'RON',
  'BGN',
  'ISK',
  'TRY',
  'MYR',
  'IDR',
  'THB',
  'PHP',
  'ILS',
  'NTD',
  'HRK',
])

export function isValidCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.has(code.toUpperCase())
}
