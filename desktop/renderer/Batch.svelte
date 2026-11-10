<script lang="ts">
  // The lines this opening of the line has written, newest first, each a ledger row under the
  // composer: its From, Amount and To, its description, its day in a pill where that isn't today,
  // and the tick and Saved at its end. It drops a new line in, scrolls past six rows, and stops.
  import { copy } from '../copy'
  import type { Batch } from './batch'
  import { columnsOf, wayOf } from './row'
  import Day from './parts/Day.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'

  type Props = {
    /** The lines the line has written, and what was taken back: only the lines show. */
    batch: Batch
    /** The day it is, so a line on any other carries its own; the caller keeps it current. */
    today: string
  }
  let { batch, today }: Props = $props()

  // Its own width, as the list's: where the columns would run out, From goes from both.
  let width = $state(0)
  const shown = $derived(columnsOf(width))
</script>

<ol class="batch" bind:clientWidth={width} aria-label={copy.spends.batch.label}>
  {#each batch.lines as line (line.id)}
    <li style:grid-template-columns={shown.template}>
      {#if shown.cells.includes('from')}
        <span data-cell="from">{#if line.fromPath}<Path path={line.fromPath} />{/if}</span>
      {/if}
      <span data-cell="amount"><Money of={line.simple ?? line.amounts} way={wayOf(line)} /></span>
      <span data-cell="to">{#if line.toPath}<Path path={line.toPath} />{/if}</span>
      <span data-cell="description">
        <span class="what">{line.description || copy.spends.noDescription}</span>
        {#if line.date !== today}
          <span class="day"><Day date={line.date} {today} /></span>
        {/if}
        <span class="saved">{copy.spends.batch.tick} {copy.spends.batch.saved}</span>
      </span>
    </li>
  {/each}
</ol>

<style>
  /* As tall as six rows, then it scrolls inside itself; the page never does. */
  .batch {
    display: grid;
    max-block-size: calc(6 * var(--row));
    margin: 0;
    padding: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    list-style: none;
  }

  li {
    display: grid;
    align-items: center;
    column-gap: var(--space-3);
    box-sizing: border-box;
    block-size: var(--row);
    padding-inline: var(--space-2);
    border-block-end: var(--border-width) solid var(--color-rule);
    /* The accent edge every line of a batch carries. */
    box-shadow: inset 3px 0 0 var(--color-accent);
    cursor: default;
    animation: drop var(--duration-drop) var(--ease-out);
  }

  li > :global(*:not([data-cell='description'])) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-cell='amount'] {
    justify-self: end;
  }

  /* The description, its day's pill after it and, at the row's end, the tick and Saved. */
  [data-cell='description'] {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A line not dated today says its day here, in an accent outline. */
  .day {
    flex: none;
    padding: 0 var(--space-2);
    border: var(--border-width) solid var(--color-accent);
    border-radius: var(--radius-pill);
    font-size: var(--text-small);
  }

  .saved {
    flex: none;
    margin-inline-start: auto;
    font-size: var(--text-small);
    color: var(--color-in);
    white-space: nowrap;
  }

  @keyframes drop {
    from {
      translate: 0 -38px;
    }
  }
</style>
