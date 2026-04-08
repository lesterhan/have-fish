<script lang="ts">
  import { currencyFlag } from '$lib/currency'
  import Icon from '$lib/components/ui/Icon.svelte'

  interface Props {
    amount: string
    currency: string
    flowDirection?: 'in' | 'out' | null
  }

  let { amount, currency, flowDirection = null }: Props = $props()

  let flag = $derived(currencyFlag(currency))
</script>

<div class="money">
  <span class="currency">{flag ? `${flag} ` : ''}{currency}</span>
  <div
    class="amount-row"
    class:flow-in={flowDirection === 'in'}
    class:flow-out={flowDirection === 'out'}
  >
    {#if flowDirection === 'in'}<Icon name="arrow-right" size={13} />{/if}
    <span class="amount">{amount}</span>
    {#if flowDirection === 'out'}<Icon name="arrow-right" size={13} />{/if}
  </div>
</div>

<style>
  .money {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
  }

  .amount-row {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .amount-row.flow-in {
    color: var(--color-transfer-in);
  }

  .amount-row.flow-out {
    color: var(--color-transfer-out);
  }

  .amount {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: inherit;
  }

  .currency {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
