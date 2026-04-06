export const CURRENCY_FLAGS: Record<string, string> = {
  CAD: '🇨🇦', EUR: '🇪🇺', GBP: '🇬🇧', USD: '🇺🇸', CNY: '🇨🇳',
  HKD: '🇭🇰', NTD: '🇹🇼', CZK: '🇨🇿', KRW: '🇰🇷', JPY: '🇯🇵',
  AUD: '🇦🇺', INR: '🇮🇳', SGD: '🇸🇬', NZD: '🇳🇿', MXN: '🇲🇽',
  CHF: '🇨🇭', NOK: '🇳🇴', SEK: '🇸🇪', DKK: '🇩🇰', PLN: '🇵🇱',
  HUF: '🇭🇺', RON: '🇷🇴', BGN: '🇧🇬', HRK: '🇭🇷', ISK: '🇮🇸',
  TRY: '🇹🇷',
}

export function currencyFlag(currency: string): string {
  return CURRENCY_FLAGS[currency] ?? ''
}
