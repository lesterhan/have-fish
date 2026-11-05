<script lang="ts">
  import type { SpendingLine } from '@have-fish/core/spending'
  import { copy } from '../copy'
  import Empty from './parts/Empty.svelte'
  import { lineLabel, moneyText } from './report'
  import { movedBy } from './selection'

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

  let list: HTMLOListElement

  export function focus() {
    list.focus()
  }

  const optionId = (key: string) => `spending-${key}`
  const keyed = $derived(lines.map((l) => ({ ...l, id: l.key })))

  function onkeydown(event: KeyboardEvent) {
    const picked = lines.find((l) => l.key === pickedKey)
    if ((event.key === 'Enter' || event.key === 'ArrowRight') && picked?.opens) {
      event.preventDefault()
      oninto(picked.category)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      event.preventDefault()
      onup()
      return
    }
    const to = movedBy(keyed, pickedKey, event.key)
    if (to === undefined) return
    event.preventDefault()
    if (to !== null) onpick(to)
  }

  // Picking a category with categories under it goes in: one level's numbers at a time.
  function onclick(event: MouseEvent) {
    const key = (event.target as Element).closest<HTMLElement>('[role=option]')?.dataset.key
    const line = lines.find((l) => l.key === key)
    if (line === undefined) return
    if (line.opens) oninto(line.category)
    else onpick(line.key)
  }
</script>

<div class="breakdown">
  <ol
    bind:this={list}
    role="listbox"
    aria-label={copy.reports.breakdown.label}
    tabindex="0"
    aria-activedescendant={pickedKey === null ? undefined : optionId(pickedKey)}
    {onkeydown}
    {onclick}
  >
    {#each lines as line (line.key)}
      <li
        id={optionId(line.key)}
        role="option"
        aria-selected={line.key === pickedKey}
        data-key={line.key}
        class:unsorted={line.kind !== 'category'}
      >
        <span class="name">{lineLabel(line)}</span>
        <span class="opens" aria-hidden="true">{line.opens ? copy.reports.breakdown.opens : ''}</span>
        <span class="bar" aria-hidden="true"><span style:inline-size="{line.share * 100}%"></span></span>
        <span class="amount">{moneyText(line.cents, currency)}</span>
      </li>
    {/each}
  </ol>
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

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 1em auto;
  }

  li {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
    column-gap: var(--space-3);
    row-gap: var(--space-1);
    padding: var(--space-2);
    border-bottom: var(--border-width) solid var(--color-rule);
    cursor: default;
  }

  li[aria-selected='true'] {
    background: var(--color-selected);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unsorted .name,
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
