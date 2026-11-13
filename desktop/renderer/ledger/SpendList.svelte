<script lang="ts">
  // A list of spends: the ledger's, or a report's. Click a row to select it, and again, or Enter,
  // to open its details under it; Esc closes them, and Delete removes the spend.
  import { type Snippet, tick } from 'svelte'
  import { copy } from '../../copy'
  import type {
    ListedDay,
    ListedPath,
    ListedTransaction,
    Money as Amount,
  } from '../../shared/commands'
  import { todayIn } from '../format'
  import PathPicker from './PathPicker.svelte'
  import Band from '../parts/Band.svelte'
  import Headings from '../parts/Headings.svelte'
  import Keys from '../parts/Keys.svelte'
  import type { Paged } from '../parts/listbox'
  import Listbox from '../parts/Listbox.svelte'
  import Money from '../parts/Money.svelte'
  import Path from '../parts/Path.svelte'
  import { columnsOf, daysOf, wayOf } from './row'
  import { windowKeyOf } from '../shortcuts'

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
    /** The line that writes a spend, above the list while it's open. */
    composer?: Snippet
    /** The composer is open: the list steps back. */
    dimmed?: boolean
    /** The list took the cursor: close what's open, as reaching for it does. */
    onstepback?: () => void
    selectedId: string | null
    /** The rows a batch landed on, lit where they land. */
    landed?: ReadonlySet<string>
    /** One of them has finished lighting: it goes back to rest. */
    onlanded?: (id: string) => void
    onselect: (id: string) => void
    /** The spend whose details are open under its row. */
    opened: string | null
    /** Its details. */
    details: Snippet<[ListedTransaction]>
    /** Open the selected spend's details; with `focus`, put the cursor in them. */
    onopen: (focus: boolean) => void
    /** A key the open details take first, while the cursor stays on their row. */
    oncardkey?: (event: KeyboardEvent) => boolean
    /** Esc on the list: close them. */
    onclose: () => void
    /** Delete on the list: remove the selected spend. */
    onremove: () => void
    /** R on the selected row: its To becomes a path picker. */
    onrefile?: (t: ListedTransaction, typed: string) => Promise<void>
    /** Every path, with its last use; the ledger reads it once per change. */
    loadPaths: () => Promise<ListedPath[]>
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
    composer,
    dimmed = false,
    onstepback,
    selectedId,
    landed,
    onlanded,
    onselect,
    opened,
    details,
    onopen,
    oncardkey,
    onclose,
    onremove,
    onrefile,
    loadPaths,
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

  /** The row whose To is a picker, and what it holds. */
  let refiling = $state<string | null>(null)
  let refileText = $state('')
  let refilePicker: PathPicker | undefined = $state()

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

  /** The newest rows: opening the composer brings today's page in. */
  export function toTop() {
    listbox.toTop()
  }

  /** The selected row, from whichever list this is. */
  function selected(): ListedTransaction | undefined {
    if (selectedId === null) return undefined
    if (transactions !== undefined) return transactions.find((t) => t.id === selectedId)
    if (paged !== undefined) {
      const at = paged.indexOf(selectedId)
      return at === -1 ? undefined : paged.at(at)
    }
    return undefined
  }

  /** R: the selected row's To becomes a path picker. Only a spend of one amount can move. */
  export function refile(): boolean {
    const t = selected()
    if (t === undefined || t.simple === null || onrefile === undefined) return false
    refiling = t.id
    refileText = t.to ?? ''
    void tick().then(() => refilePicker?.focus())
    return true
  }

  /** A path was picked for the row: save it at once, then give the list the cursor back. */
  async function saveRefile(t: ListedTransaction): Promise<void> {
    const typed = refileText
    refiling = null
    await onrefile?.(t, typed)
    listbox.focus()
  }

  // Another row selected, or the list replaced: the picker closes.
  $effect(() => {
    if (refiling !== null && refiling !== selectedId) refiling = null
  })

  function onkey(event: KeyboardEvent): boolean {
    if (refiling !== null) {
      if (event.key === 'Escape') {
        event.preventDefault()
        refiling = null
        listbox.focus()
        return true
      }
      return false
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onopen(true)
      return true
    }
    if (opened !== null && oncardkey?.(event) === true) return true
    if (event.key === 'Escape' && opened !== null) {
      event.preventDefault()
      onclose()
      return true
    }
    // Here and not in the menu, so Delete in a text field still deletes text.
    const key = windowKeyOf(event)
    if (key === 'remove') {
      event.preventDefault()
      onremove()
      return true
    }
    // R refiles the selected row's To, where its To cell is.
    if (key === 'refile') {
      if (refile()) event.preventDefault()
      return true
    }
    return false
  }
</script>

<div class="list" class:composing={composer !== undefined} bind:clientWidth={width}>
  <Headings columns={shown.template} names={headings} />
  {#if composer}{@render composer()}{/if}
  <Listbox
    bind:this={listbox}
    items={transactions}
    {paged}
    {onrange}
    {onmissing}
    {dimmed}
    onfocus={onstepback}
    idOf={(t) => t.id}
    active={selectedId}
    {label}
    {idPrefix}
    columns={shown.template}
    {groups}
    {landed}
    {onlanded}
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
    {#snippet hint()}
      <Keys key={copy.spends.list.enter} />{copy.spends.list.details}
      {#if onrefile && selected()?.simple != null}<Keys action="refile" />{copy
          .spends.list.refile}{/if}
    {/snippet}
    {#snippet row(t)}
      {#if !narrow}<span data-cell="from">{#if t.fromPath}<Path path={t.fromPath} />{/if}</span>{/if}
      <span data-cell="amount"><Money of={t.simple ?? t.amounts} way={wayOf(t.shape)} /></span>
      <span data-cell="to">
        {#if refiling === t.id}
          <PathPicker
            bind:this={refilePicker}
            id={`${idPrefix}-refile`}
            name="to"
            mode="to"
            {loadPaths}
            bind:text={refileText}
            placeholder={copy.spends.write.unsorted}
            listLabel={copy.spends.write.toList}
            onpicked={() => void saveRefile(t)}
            sits="row"
            onclose={() => {
              refiling = null
              void tick().then(() => listbox.focus())
            }}
          />
        {:else if t.toPath}
          <Path path={t.toPath} />
        {/if}
      </span>
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

  .list.composing {
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  [data-cell='amount'] {
    justify-self: end;
  }
</style>
