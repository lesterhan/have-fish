/**
 * Currency catalogue + recent-usage model for the Add screen.
 *
 * The amount pill opens a two-step Currency sheet: step 1 shows the most
 * recently used currencies, step 2 the full catalogue with recents floated to
 * the top. There is no quick-currency concept in the backend, so the recent
 * list is tracked locally (AsyncStorage, global across groups) — mirroring the
 * web app's `preferences.recentCurrencies`, but device-local for now.
 *
 * The supported list mirrors `frontend/src/lib/currency.ts` (itself a mirror of
 * `backend/src/currencies.ts`). Keep them in sync when adding a currency.
 */

/** Full supported list, in display order. Mirrors the web `SUPPORTED_CURRENCIES`. */
export const ALL_CURRENCIES = [
  'CAD', 'EUR', 'GBP', 'USD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'HKD',
  'SGD', 'INR', 'KRW', 'MXN', 'BRL', 'ZAR', 'NOK', 'SEK', 'DKK', 'CZK',
  'PLN', 'HUF', 'RON', 'BGN', 'ISK', 'TRY', 'MYR', 'IDR', 'THB', 'PHP',
  'ILS', 'NTD', 'HRK',
] as const

export type CurrencyCode = (typeof ALL_CURRENCIES)[number]

/** How many recents the step-1 sheet shows. */
export const RECENT_VISIBLE = 3
/** Cap on the stored recent list (mirrors the web app's cap of 8). */
export const RECENT_CAP = 8

const FLAGS: Record<string, string> = {
  CAD: '🇨🇦', EUR: '🇪🇺', GBP: '🇬🇧', USD: '🇺🇸', AUD: '🇦🇺', NZD: '🇳🇿',
  CHF: '🇨🇭', JPY: '🇯🇵', CNY: '🇨🇳', HKD: '🇭🇰', SGD: '🇸🇬', INR: '🇮🇳',
  KRW: '🇰🇷', MXN: '🇲🇽', BRL: '🇧🇷', ZAR: '🇿🇦', NOK: '🇳🇴', SEK: '🇸🇪',
  DKK: '🇩🇰', CZK: '🇨🇿', PLN: '🇵🇱', HUF: '🇭🇺', RON: '🇷🇴', BGN: '🇧🇬',
  ISK: '🇮🇸', TRY: '🇹🇷', MYR: '🇲🇾', IDR: '🇮🇩', THB: '🇹🇭', PHP: '🇵🇭',
  ILS: '🇮🇱', NTD: '🇹🇼', HRK: '🇭🇷',
}

/** Flag emoji for a currency code, or empty string when unknown. */
export function currencyFlag(code: string): string {
  return FLAGS[code] ?? ''
}

/** True when the code is one we support. */
export function isSupportedCurrency(code: string): boolean {
  return (ALL_CURRENCIES as readonly string[]).includes(code)
}

/** AsyncStorage key for a group's last-used currency (the pill's sticky value). */
export const lastCurrencyKey = (groupId: string) => `havefish_last_currency_${groupId}`

/** AsyncStorage key for the global recent-currency list. */
export const RECENT_CURRENCIES_KEY = 'havefish_recent_currencies'

/**
 * Push a freshly used currency to the front of the recent list (deduped,
 * capped). Most-recent-first. Returns a new array.
 */
export function pushRecent(recents: readonly string[], code: string, cap = RECENT_CAP): string[] {
  return [code, ...recents.filter((c) => c !== code)].slice(0, cap)
}

/**
 * The step-1 recents to show: the current selection first, then the stored
 * recents, deduped and capped to {@link RECENT_VISIBLE}. Guarantees the active
 * currency always appears even on a cold start with no history.
 */
export function topRecents(selected: string, recents: readonly string[], n = RECENT_VISIBLE): string[] {
  return [selected, ...recents.filter((c) => c !== selected)].slice(0, n)
}

/**
 * Full catalogue ordered with recents floated to the top (in recent order),
 * then the remaining supported currencies in their canonical order. Mirrors the
 * web dropdown's recents-first sort.
 */
export function orderByRecent(recents: readonly string[]): string[] {
  const supported = new Set<string>(ALL_CURRENCIES)
  const recentsFirst = recents.filter((c) => supported.has(c))
  const seen = new Set(recentsFirst)
  const others = ALL_CURRENCIES.filter((c) => !seen.has(c))
  return [...recentsFirst, ...others]
}
