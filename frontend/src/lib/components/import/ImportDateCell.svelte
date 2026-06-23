<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tooltip } from '$lib/tooltip'
  import type { PossibleDuplicate } from '$lib/api'
  import { parseDateParts } from '$lib/components/transactions/transactionUtils'

  interface Props {
    date: string
    possibleDuplicate?: PossibleDuplicate | null
  }

  let { date, possibleDuplicate }: Props = $props()

  let parts = $derived(parseDateParts(date))
</script>

<td class="cell-date">
  <span class="date-stack">
    <span class="date-meta">{parts.year} {parts.dow}</span>
    <span class="date-main">{parts.monthDay}</span>
  </span>
  {#if possibleDuplicate}
    <span
      class="indicator-icon"
      use:tooltip={{
        label: `Possible duplicate: ${possibleDuplicate.date} ${possibleDuplicate.amount} ${possibleDuplicate.currency}`,
        always: true,
      }}
    >
      <Icon name="warning-filled" size={16} />
    </span>
  {/if}
</td>

<style>
  /* Stacked date — year + weekday over month/day — matching the transactions page so the
     two views read the same. Replaces the dense numeric MM/DD/YY. */
  .cell-date {
    white-space: nowrap;
  }
  .date-stack {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    font-family: var(--font-mono);
    vertical-align: middle;
  }
  .date-meta {
    font-size: 9px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .date-main {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text);
  }
</style>
