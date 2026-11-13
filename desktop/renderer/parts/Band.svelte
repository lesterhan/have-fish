<script lang="ts">
  // A band over a group of rows: a day, or what an account's root is, and what they come to at
  // the right. A day's net is main's, summed in SQL over the whole day, never over the rows the
  // window holds (see #611).
  import type { Snippet } from 'svelte'
  import type { Money as Amount } from '../../shared/currency'
  import Day from './Day.svelte'
  import Money from './Money.svelte'

  type Props = {
    /** The day, or `children` in its place. */
    date?: string | undefined
    today?: string | undefined
    /** Undefined until the day's net arrives; a day that nets to nothing has none. */
    net?: readonly Amount[] | undefined
    children?: Snippet | undefined
  }
  let { date, today, net, children }: Props = $props()
</script>

<div class="band">
  <span class="what"
    >{#if children}{@render children()}{:else if date !== undefined}<Day {date} {today} band />{/if}</span
  >
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
