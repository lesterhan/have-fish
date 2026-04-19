<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'

  interface Props {
    amount: string
    currency: string
    flowDirection?: 'in' | 'out' | null
    inline?: boolean
  }

  let { amount, currency, flowDirection = null, inline = false }: Props = $props()
</script>

{#if inline}
  <div
    class="money-inline"
    class:flow-in={flowDirection === 'in'}
    class:flow-out={flowDirection === 'out'}
  >
    {#if flowDirection === 'in'}<Icon name="arrow-right" size={11} />{/if}
    <CurrencyPill code={currency} size="xs" />
    <span class="amount">{amount}</span>
    {#if flowDirection === 'out'}<Icon name="arrow-right" size={11} />{/if}
  </div>
{:else}
  <div class="money">
    <CurrencyPill code={currency} size="xs" />
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
{/if}

<style>
  /* --- Stacked (default) --- */
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

  /* --- Inline --- */
  .money-inline {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .money-inline.flow-in {
    color: var(--color-transfer-in);
  }

  .money-inline.flow-out {
    color: var(--color-transfer-out);
  }

  /* --- Shared --- */
  .amount {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: inherit;
  }

  /* Inline mode is used in compact single-line rows — match body text size */
  .money-inline .amount {
    font-size: var(--text-sm);
  }

</style>
