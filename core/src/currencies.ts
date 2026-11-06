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

/** The currencies whose amounts are whole: no cents to type, none to show. */
const WHOLE = new Set<string>(['JPY', 'KRW', 'ISK'])

/** Digits after the point an amount in `code` has. Storage keeps two for every currency. */
export const minorUnits = (code: string): 0 | 2 => (WHOLE.has(code) ? 0 : 2)

/** Whether `cents` is an amount `code` can carry: ¥1,500, not ¥1,500.50. */
export const fitsCurrency = (cents: number, code: string): boolean =>
  minorUnits(code) === 2 || cents % 100 === 0
