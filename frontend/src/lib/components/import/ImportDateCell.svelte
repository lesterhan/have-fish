<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import { copy } from '$lib/copy'
  import { tooltip } from '$lib/tooltip'
  import type { PossibleDuplicate } from '$lib/api'
  import { parseDateParts } from '$lib/components/transactions/transactionUtils'

  interface Props {
    date: string
    possibleDuplicate?: PossibleDuplicate | null | undefined
  }

  let { date, possibleDuplicate }: Props = $props()

  let parts = $derived(parseDateParts(date))

  // The row it matched, as data: its date, amount and currency, in the order the table reads.
  let duplicateLabel = $derived.by(() => {
    const dup = possibleDuplicate
    if (!dup) return ''
    const match = `${dup.date} ${dup.amount} ${dup.currency}`
    return dup.certain
      ? copy.import.row.duplicate.certain(match)
      : copy.import.row.duplicate.possible(match)
  })
</script>

<td class="cell-date">
  <span class="date-stack">
    <span class="date-meta">{parts.year} {parts.dow}</span>
    <span class="date-main">{parts.monthDay}</span>
  </span>
  {#if possibleDuplicate}
    <span
      class="indicator-icon warn"
      use:tooltip={{
        label: duplicateLabel,
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
    gap: var(--sp-hair);
    font-family: var(--font-mono);
    vertical-align: middle;
  }
  .date-meta {
    font-size: var(--text-micro);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .date-main {
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    color: var(--color-text);
  }
</style>
