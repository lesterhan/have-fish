// The currencies a posting can carry. The current app's list as it stands, so its ledgers carry
// over: the currencies its rate source quotes, plus NTD, BGN and HRK, which older entries use.
export const CURRENCIES = [
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
] as const

export type Currency = (typeof CURRENCIES)[number]
const SUPPORTED_CURRENCY = new Set<string>(CURRENCIES)

export function isValidCurrency(code: string): code is Currency {
  return SUPPORTED_CURRENCY.has(code)
}
