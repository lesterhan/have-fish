<script lang="ts">
  import { copy } from '../copy'
  import type { ListedDay, ListedTransaction, Money as Amount } from '../shared/commands'
  import type { Drafts } from './drafts'
  import { todayIn } from './format'
  import { NARROW } from './narrow'
  import Band from './parts/Band.svelte'
  import Headings from './parts/Headings.svelte'
  import Keys from './parts/Keys.svelte'
  import type { Paged } from './parts/listbox'
  import Listbox from './parts/Listbox.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'
  import { daysOf, wayOf } from './row'
  import Unsaved from './Unsaved.svelte'

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
    days,
    nets,
    onrange,
    onmissing,
    selectedId,
    written = null,
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
  const shownDays = $derived(days ?? (transactions ? daysOf(transactions) : []))
  const groups = $derived(shownDays.map((d) => d.count))

  // Below the narrow width the From column goes; the details still show it.
  let narrow = $state(matchMedia(NARROW).matches)
  $effect(() => {
    const query = matchMedia(NARROW)
    const changed = () => (narrow = query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  })
  const names = copy.spends.list.columns
  // From, Amount, To, Description, and the ● of a draft (DESIGN.md, "Layout").
  const columns = $derived(
    [...(narrow ? [] : ['min(196px,28%)']), '92px', 'minmax(0,1.2fr)', 'minmax(0,1fr)', '1em'].join(' '),
  )
  const headings = $derived([
    ...(narrow ? [] : [names.from]),
    names.amount,
    names.to,
    names.description,
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
  <Headings {columns} names={headings} />
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
    {columns}
    {groups}
    {written}
    onactive={onselect}
    onpick={(id) => {
      onselect(id)
      onopen(false)
    }}
    {onkey}
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
      <span data-cell="draft">{#if drafts.has(t.id)}<Unsaved />{/if}</span>
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
