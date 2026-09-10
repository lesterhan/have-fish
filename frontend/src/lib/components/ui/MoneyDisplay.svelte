<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import type { AmountTone } from '$lib/components/transactions/amountTone'

  interface Props {
    amount: string
    currency: string
    flowDirection?: 'in' | 'out' | null
    inline?: boolean
    /** Bold the figure — for the one amount a row is actually about. */
    emphasis?: boolean
    /**
     * Which of the three ledger meanings this figure carries (DESIGN.md §5). It lives here
     * rather than on each caller's cell because the rule is one rule: the account page used
     * to express it in its own stylesheet and the transactions list did not express it at
     * all, which is how one screen idea got implemented once and skipped once.
     *
     * `transfer` deliberately paints nothing — a transfer's colour is its *direction*, and
     * that comes from `flowDirection` below. Money moving between your own accounts is not
     * a gain and must never read as green.
     */
    tone?: AmountTone
  }

  let {
    amount,
    currency,
    flowDirection = null,
    inline = false,
    emphasis = false,
    tone = 'neutral',
  }: Props = $props()
</script>

{#if inline}
  <div
    class="money-inline"
    class:tone-positive={tone === 'positive'}
    class:flow-in={flowDirection === 'in'}
    class:flow-out={flowDirection === 'out'}
  >
    {#if flowDirection === 'in'}<Icon name="arrow-right" size={11} />{/if}
    <CurrencyPill code={currency} size="xs" />
    <span class="amount" class:emphasis>{amount}</span>
    {#if flowDirection === 'out'}<Icon name="arrow-right" size={11} />{/if}
  </div>
{:else}
  <div class="money">
    <CurrencyPill code={currency} size="xs" />
    <div
      class="amount-row"
      class:tone-positive={tone === 'positive'}
      class:flow-in={flowDirection === 'in'}
      class:flow-out={flowDirection === 'out'}
    >
      {#if flowDirection === 'in'}<Icon name="arrow-right" size={13} />{/if}
      <span class="amount" class:emphasis>{amount}</span>
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
    gap: var(--sp-3xs);
  }

  /* Only money coming back is tinted; an ordinary spend is the default and defaults do not
     need a colour. The flow rules follow and win, which is what keeps a transfer neutral
     directional rather than green. */
  .amount-row.tone-positive,
  .money-inline.tone-positive {
    color: var(--color-amount-positive);
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
    gap: var(--sp-3xs);
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
    font-size: var(--text-amount);
    color: inherit;
  }

  .amount.emphasis {
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }

  /* Inline mode is used in compact single-line rows — match body text size */
  .money-inline .amount {
    font-size: var(--text-body);
  }
</style>
