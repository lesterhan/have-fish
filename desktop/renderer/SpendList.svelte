<script lang="ts">
  // A list of spends: the ledger's, or a report's. Click a row to select it, and again, or Enter,
  // to open its details under it; Esc closes them, and Delete removes the spend.
  import type { Snippet } from 'svelte'
  import { copy } from '../copy'
  import type { ListedDay, ListedTransaction, Money as Amount } from '../shared/commands'
  import { todayIn } from './format'
  import Band from './parts/Band.svelte'
  import Headings from './parts/Headings.svelte'
  import Keys from './parts/Keys.svelte'
  import type { Paged } from './parts/listbox'
  import Listbox from './parts/Listbox.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'
  import { columnsOf, daysOf, wayOf } from './row'

  type Props = {
    /** The spends, all of them here; or `paged`, the ledger's list a page at a time. */
    transactions?: ListedTransaction[]
    paged?: Paged<ListedTransaction>
    /** A paged list's days, from main; a list held whole works out its own. */
    days?: readonly ListedDay[]
    /** What each day came to, where it's known. */
    nets?: ReadonlyMap<string, readonly Amount[]>
    /** The rows drawn changed: their pages are wanted. */
    onrange?: (from: number, to: number) => void
    /** The keys moved to a row whose page isn't here yet. */
    onmissing?: (index: number) => void
    selectedId: string | null
    /** The row just written, which slides in. */
    written?: string | null
    onselect: (id: string) => void
    /** The spend whose details are open under its row. */
    opened: string | null
    /** Its details. */
    details: Snippet<[ListedTransaction]>
    /** Open the selected spend's details; with `focus`, put the cursor in them. */
    onopen: (focus: boolean) => void
    /** Esc on the list: close them. */
    onclose: () => void
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
    days,
    nets,
    onrange,
    onmissing,
    selectedId,
    written = null,
    onselect,
    opened,
    details,
    onopen,
    onclose,
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
  const shownDays = $derived(days ?? (transactions ? daysOf(transactions) : []))
  const groups = $derived(shownDays.map((d) => d.count))

  // A narrow list leaves From out (the details still show it): the list's width, not the window's.
  let width = $state(0)
  const shown = $derived(columnsOf(width))
  const narrow = $derived(!shown.cells.includes('from'))
  const names = copy.spends.list.columns
  const headings = $derived([
    ...(narrow ? [] : [{ name: names.from }]),
    { name: names.amount, end: true },
    { name: names.to },
    { name: names.description },
  ])

  export function focus() {
    listbox.focus()
  }

  function onkey(event: KeyboardEvent): boolean {
    if (event.key === 'Enter') {
      event.preventDefault()
      onopen(true)
      return true
    }
    if (event.key === 'Escape' && opened !== null) {
      event.preventDefault()
      onclose()
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

<div class="list" bind:clientWidth={width}>
  <Headings columns={shown.template} names={headings} />
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
    columns={shown.template}
    {groups}
    {written}
    onactive={onselect}
    onpick={(id) => {
      // Once to select, again to open.
      if (id === selectedId) onopen(false)
      else onselect(id)
    }}
    {onkey}
    {opened}
    {details}
  >
    {#snippet band(g)}
      {@const day = shownDays[g]}
      {#if day}<Band date={day.date} {today} net={nets?.get(day.date)} />{/if}
    {/snippet}
    {#snippet hint()}<Keys key={copy.spends.list.enter} />{copy.spends.list.details}{/snippet}
    {#snippet row(t)}
      {#if !narrow}<span data-cell="from">{#if t.fromPath}<Path path={t.fromPath} />{/if}</span>{/if}
      <span data-cell="amount"><Money of={t.simple ?? t.amounts} way={wayOf(t)} /></span>
      <span data-cell="to">{#if t.toPath}<Path path={t.toPath} />{/if}</span>
      <span data-cell="description">{t.description || copy.spends.noDescription}</span>
    {/snippet}
  </Listbox>
</div>

<style>
  .list {
    grid-area: list;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  [data-cell='amount'] {
    justify-self: end;
  }
</style>
