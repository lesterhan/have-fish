<script lang="ts">
  import type { ListedTransaction } from '../shared/commands'
  import { spends as copy } from './copy/spends'
  import type { Drafts } from './drafts'
  import { amountsText } from './format'
  import { movedBy } from './selection'
  import Unsaved from './Unsaved.svelte'

  type Props = {
    transactions: ListedTransaction[]
    selectedId: string | null
    drafts: Drafts
    onselect: (id: string) => void
    /** Show the pane; with `focus`, put the cursor in it. */
    onopen: (focus: boolean) => void
  }
  let { transactions, selectedId, drafts, onselect, onopen }: Props = $props()

  let list: HTMLOListElement

  export function focus() {
    list.focus()
  }

  const optionId = (id: string) => `spend-${id}`

  // Keeps the selected row in view as the keys move it.
  $effect(() => {
    if (selectedId !== null) {
      document.getElementById(optionId(selectedId))?.scrollIntoView({ block: 'nearest' })
    }
  })

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onopen(true)
      return
    }
    const to = movedBy(transactions, selectedId, event.key)
    if (to === undefined) return
    event.preventDefault()
    if (to !== null) onselect(to)
  }

  function onclick(event: MouseEvent) {
    const id = (event.target as Element).closest<HTMLElement>('[role=option]')?.dataset.id
    if (id === undefined) return
    onselect(id)
    onopen(false)
  }
</script>

<ol
  bind:this={list}
  role="listbox"
  aria-label={copy.list.label}
  tabindex="0"
  aria-activedescendant={selectedId === null ? undefined : optionId(selectedId)}
  {onkeydown}
  {onclick}
>
  {#each transactions as t (t.id)}
    <li id={optionId(t.id)} role="option" aria-selected={t.id === selectedId} data-id={t.id}>
      <span class="date">{t.date}</span>
      <span class="description">{t.description || '—'}</span>
      <span class="amount">{amountsText(t.amounts)}</span>
      {#if drafts.has(t.id)}<Unsaved />{/if}
    </li>
  {/each}
</ol>

<style>
  ol {
    grid-area: list;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    /* A track for the ● even when it's absent, so amounts stay in one column. */
    grid-template-columns: auto minmax(0, 1fr) auto 1em;
    gap: var(--space-3);
    padding: var(--space-2);
    border-bottom: var(--border-width) solid var(--color-rule);
    cursor: default;
  }

  li[aria-selected='true'] {
    background: var(--color-selected);
  }

  .date {
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
  }

  .description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .amount {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
</style>
