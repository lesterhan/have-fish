<script lang="ts">
  interface Props {
    amount: string
    currency: string
  }

  let { amount, currency }: Props = $props()

  const FLAGS: Record<string, string> = {
    CAD: '🇨🇦',
    EUR: '🇪🇺',
    GBP: '🇬🇧',
    USD: '🇺🇸',
    CNY: '🇨🇳',
    HKD: '🇭🇰',
    NTD: '🇹🇼',
    CZK: '🇨🇿',
    KRW: '🇰🇷',
    JPY: '🇯🇵',
    AUD: '🇦🇺',
    INR: '🇮🇳',
    SGD: '🇸🇬',
    NZD: '🇳🇿',
    MXN: '🇲🇽',
    CHF: '🇨🇭',
    NOK: '🇳🇴',
    SEK: '🇸🇪',
    DKK: '🇩🇰',
    PLN: '🇵🇱',
    HUF: '🇭🇺',
    RON: '🇷🇴',
    BGN: '🇧🇬',
    HRK: '🇭🇷',
    ISK: '🇮🇸',
    TRY: '🇹🇷',
  }

  let flag = $derived(FLAGS[currency] ?? '')
</script>

<div class="money">
  <span class="currency">{flag ? `${flag} ` : ''}{currency}</span>
  <span class="amount">{amount}</span>
</div>

<style>
  .money {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
  }

  .amount {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .currency {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
