<script lang="ts">
  // A day's band over its rows: the day, and what it came to at the right. Its net is main's,
  // summed in SQL over the whole day, never over the rows the window holds (see #611).
  import type { Money as Amount } from '../../shared/commands'
  import Day from './Day.svelte'
  import Money from './Money.svelte'

  type Props = {
    date: string
    today: string
    /** Undefined until the day's net arrives; a day that nets to nothing has none. */
    net?: readonly Amount[] | undefined
  }
  let { date, today, net }: Props = $props()
</script>

<div class="band">
  <span class="day"><Day {date} {today} band /></span>
  {#if net !== undefined && net.length > 0}<span class="net"><Money of={net} /></span>{/if}
</div>

<style>
  .band {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    block-size: var(--band);
    padding-inline: var(--space-2);
    box-sizing: border-box;
    font-size: var(--text-small);
    color: var(--color-muted);
    background: var(--color-band);
    border-block-end: var(--border-width) solid var(--color-rule);
  }
</style>
