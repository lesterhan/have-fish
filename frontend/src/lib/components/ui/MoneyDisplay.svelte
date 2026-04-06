<script lang="ts">
  import { currencyFlag } from '$lib/currency'

  interface Props {
    amount: string
    currency: string
  }

  let { amount, currency }: Props = $props()

  let flag = $derived(currencyFlag(currency))
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
