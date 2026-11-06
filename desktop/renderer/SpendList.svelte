<script lang="ts">
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import type { Drafts } from './drafts'
  import { amountsText, day, todayIn } from './format'
  import type { Paged } from './parts/listbox'
  import Listbox from './parts/Listbox.svelte'
  import Unsaved from './Unsaved.svelte'

  type Props = {
    /** The spends, all of them here; or `paged`, the ledger's list a page at a time. */
    transactions?: ListedTransaction[]
    paged?: Paged<ListedTransaction>
    /** The rows drawn changed: their pages are wanted. */
    onrange?: (from: number, to: number) => void
    /** The keys moved to a row whose page isn't here yet. */
    onmissing?: (index: number) => void
    selectedId: string | null
    drafts: Drafts
    onselect: (id: string) => void
    /** Show the pane; with `focus`, put the cursor in it. */
    onopen: (focus: boolean) => void
    /** Delete on the list: remove the selected spend. */
    onremove: () => void
    /** What it's called, where there's more than one list of spends. */
    label?: string
    /** Starts each row's id, unique in the window. */
    idPrefix?: string
  }
  let {
    transactions,
    paged,
    onrange,
    onmissing,
    selectedId,
    drafts,
    onselect,
    onopen,
    onremove,
    label = copy.spends.list.label,
    idPrefix = 'spend',
  }: Props = $props()

  let listbox: ReturnType<typeof Listbox<ListedTransaction>>
  /** Asked again with each change to the list, so a day past midnight says its year right. */
  const today = $derived.by(() => {
    void transactions
    void paged
    return todayIn()
  })

  export function focus() {
    listbox.focus()
  }

  function onkey(event: KeyboardEvent): boolean {
    if (event.key === 'Enter') {
      event.preventDefault()
      onopen(true)
      return true
    }
    // Here and not in the menu, so Delete in a text field still deletes text.
    if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      onremove()
      return true
    }
    return false
  }
</script>

<div class="list">
  <Listbox
    bind:this={listbox}
    items={transactions}
    {paged}
    {onrange}
    {onmissing}
    idOf={(t) => t.id}
    active={selectedId}
    {label}
    {idPrefix}
    columns="auto minmax(0, 1fr) auto 1em"
    onactive={onselect}
    onpick={(id) => {
      onselect(id)
      onopen(false)
    }}
    {onkey}
  >
    {#snippet row(t)}
      <span class="date">{day(t.date, today)}</span>
      <span class="description">{t.description || copy.spends.noDescription}</span>
      <span class="amount">{amountsText(t.amounts)}</span>
      {#if drafts.has(t.id)}<Unsaved />{/if}
    {/snippet}
  </Listbox>
</div>

<style>
  .list {
    grid-area: list;
    display: grid;
    min-height: 0;
  }

  .date {
    font-family: var(--font-figures);
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
  }

  .description {
    font-family: var(--font-serif);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .amount {
    font-family: var(--font-figures);
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
</style>
