<script lang="ts">
  import type { SpendingLine } from '@have-fish/core/spending'
  import { copy } from '../copy'
  import Empty from './parts/Empty.svelte'
  import { lineLabel, moneyText } from './report'
  import Listbox from './parts/Listbox.svelte'

  type Props = {
    lines: SpendingLine[]
    total: number
    currency: string
    pickedKey: string | null
    /** Shows the spends behind a line. */
    onpick: (key: string) => void
    /** Goes into a category with categories under it. */
    oninto: (category: string) => void
    /** Back out to the level above. */
    onup: () => void
  }
  let { lines, total, currency, pickedKey, onpick, oninto, onup }: Props = $props()

  let listbox: ReturnType<typeof Listbox<SpendingLine>>

  export function focus() {
    listbox.focus()
  }

  function onkey(event: KeyboardEvent): boolean {
    const picked = lines.find((l) => l.key === pickedKey)
    if ((event.key === 'Enter' || event.key === 'ArrowRight') && picked?.opens) {
      event.preventDefault()
      oninto(picked.category)
      return true
    }
    if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      event.preventDefault()
      onup()
      return true
    }
    return false
  }

  // Picking a category with categories under it goes in: one level's numbers at a time.
  function onpicked(key: string) {
    const line = lines.find((l) => l.key === key)
    if (line === undefined) return
    if (line.opens) oninto(line.category)
    else onpick(line.key)
  }
</script>

<div class="breakdown">
  <Listbox
    bind:this={listbox}
    items={lines}
    idOf={(l) => l.key}
    active={pickedKey}
    label={copy.reports.breakdown.label}
    idPrefix="spending"
    columns="minmax(0, 1fr) 1em auto"
    height={(_, rowHeight) => rowHeight + 12}
    onactive={onpick}
    onpick={onpicked}
    {onkey}
  >
    {#snippet row(line)}
      <span class="name" class:unsorted={line.kind !== 'category'}>{lineLabel(line)}</span>
      <span class="opens" aria-hidden="true">{line.opens ? copy.reports.breakdown.opens : ''}</span>
      <span class="bar" aria-hidden="true"><span style:inline-size="{line.share * 100}%"></span></span>
      <span class="amount">{moneyText(line.cents, currency)}</span>
    {/snippet}
  </Listbox>
  {#if lines.length === 0}
    <Empty>{copy.reports.breakdown.nothing}</Empty>
  {:else}
    <p class="total">
      <span>{copy.reports.breakdown.total}</span>
      <span class="amount">{moneyText(total, currency)}</span>
    </p>
  {/if}
</div>

<style>
  .breakdown {
    display: grid;
    align-content: start;
    gap: var(--space-2);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.unsorted,
  .opens {
    color: var(--color-muted);
  }

  /* Under the name and amount, across the line, so the names keep their room. */
  .bar {
    grid-column: 1 / -1;
    grid-row: 2;
    block-size: 0.375rem;
    background: var(--color-rule);
    border-radius: var(--radius-chip);
    overflow: hidden;
  }

  .bar span {
    display: block;
    block-size: 100%;
    background: var(--color-border);
  }

  .amount {
    font-family: var(--font-figures);
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  p {
    margin: 0;
  }

  .total {
    display: flex;
    justify-content: space-between;
    padding: var(--space-2);
    font-weight: var(--weight-strong);
  }
</style>
