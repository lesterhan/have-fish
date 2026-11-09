<script lang="ts" generics="T">
  // Every list in the app: its roles, `aria-activedescendant`, the keys, a click by id, and only
  // the rows in view drawn, with the space above and below them kept so the scrollbar is the
  // whole list's. A list is `items`, or `paged` when the window holds only some of it (see #608).
  // Rows can come in groups, each under a band, and the top one's band stays while its rows pass
  // under it (see #611). A row can open, its details under it in the room the rows below make
  // for them: inside the scroller, outside the listbox, which holds only options. The rules are in
  // `listbox.ts`; each row is a `Row`.
  import { onMount, type Snippet, untrack } from 'svelte'
  import {
    groupedOf,
    type Layout,
    movedTo,
    offsetsOf,
    type Paged,
    scrolledTo,
    uniformOf,
    windowOf,
    withRoom,
  } from './listbox'
  import Row from './Row.svelte'

  type Props = {
    /** The whole list; or `paged`. */
    items?: readonly T[] | undefined
    paged?: Paged<T> | undefined
    /** The rows drawn changed, `from` up to `to`: a paged list fetches them. */
    onrange?: ((from: number, to: number) => void) | undefined
    /** The keys moved to a row of a paged list that isn't here yet. */
    onmissing?: ((index: number) => void) | undefined
    /** Each item's id, unique in the list. */
    idOf: (item: T) => string
    /** The active item's id: the selection, or a picker's highlighted option. */
    active: string | null
    label: string
    /** Starts each option's element id, unique in the window. */
    idPrefix: string
    /** The row's columns; the cells `row` renders are its children. */
    columns: string
    row: Snippet<[T]>
    /** An item's height in px, where rows differ; every row is `--row` high otherwise. Not paged. */
    height?: (item: T, row: number) => number
    /** Shown but never active: a parent account nobody added. */
    disabled?: (item: T) => boolean
    /** The keys moved the active item. */
    onactive: (id: string) => void
    /** An item was clicked. */
    onpick: (id: string) => void
    /** A key the list doesn't move by, first: true if it was handled. */
    onkey?: (event: KeyboardEvent) => boolean
    /** The list itself took the cursor (a click, Tab): a place may step something back. */
    onfocus?: (() => void) | undefined
    /**
     * How many rows each group has, in order: a day's. Each group's first row carries `band`
     * above it. Ignored unless they add up to the list's rows.
     */
    groups?: readonly number[] | undefined
    /** The band of group `g`. */
    band?: Snippet<[number]> | undefined
    /** Shown on the selected row while the list has focus: what its keys do. */
    hint?: Snippet | undefined
    /** The row just written: it slides in and washes. */
    written?: string | null | undefined
    /** Wraps at the ends, as a picker does. */
    wrap?: boolean
    /** A combobox's field, which keeps the cursor: the list sets its active descendant. */
    owner?: HTMLElement | undefined
    hidden?: boolean
    /** The item whose details show under its row, lifted with it; the rest step back. */
    opened?: string | null | undefined
    details?: Snippet<[T]> | undefined
    /** The composer is open: the list steps back, and reaching for it closes the line. */
    dimmed?: boolean
  }
  let {
    items,
    paged,
    onrange,
    onmissing,
    idOf,
    active,
    label,
    idPrefix,
    columns,
    row,
    height,
    disabled,
    groups,
    band,
    hint,
    written,
    onactive,
    onpick,
    onkey,
    onfocus,
    wrap = false,
    owner,
    hidden = false,
    opened = null,
    details,
    dimmed = false,
  }: Props = $props()

  let list: HTMLOListElement
  let scroller: HTMLDivElement
  /** Below the tile of an opened row and its details, before the next row. */
  const GAP = 8
  /** The opened row's details, as tall as they draw. */
  let detailsHeight = $state(0)
  let scrollTop = $state(0)
  let viewport = $state(0)
  /** `--row` and `--band` from the stylesheet, so density changes them there and only there. */
  let rowHeight = $state(33)
  let bandHeight = $state(26)

  const count = $derived(items?.length ?? paged?.count ?? 0)
  const itemAt = (i: number): T | undefined => (items ? items[i] : paged?.at(i))
  const grouped = $derived(
    band && groups && groups.reduce((a, b) => a + b, 0) === count
      ? groupedOf(groups, rowHeight, bandHeight)
      : undefined,
  )
  // Rows of one height are worked out, not stored, so a paged list costs nothing per row.
  const rows: Layout = $derived(
    grouped ??
      (items && height
        ? offsetsOf(items.map((item) => height(item, rowHeight)))
        : uniformOf(count, rowHeight)),
  )
  const openAt = $derived(details ? indexOf(opened) : -1)
  const openItem = $derived(openAt < 0 ? undefined : itemAt(openAt))
  /** Under the opened row, its details and a gap: the room the rows below make. */
  const room = $derived(openItem === undefined ? 0 : detailsHeight + GAP)
  const offsets: Layout = $derived(withRoom(rows, openAt, room))
  /** What the band that stays at the top covers. */
  const covered = $derived(grouped ? bandHeight : 0)
  /** The group of the row at the top of the view, whose band stays there. */
  const topGroup = $derived(grouped && count > 0 ? grouped.groupAt(offsets.indexAt(scrollTop)) : -1)
  /** Where each id is: built once per change to the list, so a key press is a lookup. */
  const positions = $derived(items && new Map(items.map((item, i) => [idOf(item), i])))
  const shown = $derived(windowOf(offsets, scrollTop, viewport))
  const drawn = $derived(
    Array.from({ length: shown.to - shown.from }, (_, i) => ({
      index: shown.from + i,
      item: itemAt(shown.from + i),
    })),
  )
  const at = $derived(indexOf(active))
  /** Named only while drawn: scrolled out, the list has no element to point at. */
  const descendant = $derived(at >= shown.from && at < shown.to ? optionId(active) : undefined)

  function indexOf(id: string | null | undefined): number {
    if (id === null || id === undefined) return -1
    return positions ? (positions.get(id) ?? -1) : (paged?.indexOf(id) ?? -1)
  }

  function optionId(id: string | null) {
    return id === null ? undefined : `${idPrefix}-${id}`
  }

  export function focus() {
    list.focus()
  }

  /** The top of the list: the newest rows, where a new line opens above today. */
  export function toTop() {
    scroller.scrollTop = 0
    scrollTop = 0
  }

  onMount(() => {
    const css = (name: string) => Number.parseFloat(getComputedStyle(list).getPropertyValue(name))
    if (css('--row') > 0) rowHeight = css('--row')
    if (css('--band') > 0) bandHeight = css('--band')
    const resized = new ResizeObserver(() => (viewport = scroller.clientHeight))
    resized.observe(scroller)
    return () => resized.disconnect()
  })

  // The keys move the active item past what's drawn; the list scrolls to keep it in view. Only
  // when the active item changes: a page arriving with it in mustn't pull the list back to it.
  // Opened, the row scrolls so its details show too, once they've drawn.
  $effect(() => {
    void active
    void room
    untrack(() => {
      const index = at
      const height = viewport || scroller.clientHeight
      const to = scrolledTo(offsets, index, scroller.scrollTop, height, covered)
      if (to !== scroller.scrollTop) scroller.scrollTop = scrollTop = to
    })
  })

  $effect(() => {
    const { from, to } = shown
    untrack(() => onrange?.(from, to))
  })

  // A combobox's field says which option is active, since the cursor stays in it.
  $effect(() => {
    if (owner === undefined) return
    if (descendant === undefined) owner.removeAttribute('aria-activedescendant')
    else owner.setAttribute('aria-activedescendant', descendant)
  })

  /** Moves the active item if `event` is a key that does: true if it did. */
  export function press(event: KeyboardEvent): boolean {
    if (onkey?.(event)) return true
    const to = movedTo(offsets, at, event.key, viewport || scroller.clientHeight, {
      wrap,
      skip: (i) => {
        const item = itemAt(i)
        return item !== undefined && (disabled?.(item) ?? false)
      },
    })
    if (to === undefined) return false
    event.preventDefault()
    const item = itemAt(to)
    if (item === undefined) onmissing?.(to)
    else if (to !== at) onactive(idOf(item))
    return true
  }

  function chosen(event: MouseEvent): string | undefined {
    const option = (event.target as Element).closest<HTMLElement>('[role=option]')
    if (option === null || option.getAttribute('aria-disabled') === 'true') return undefined
    return option.dataset.id
  }

  // A combobox picks on mousedown, before its field loses the cursor and closes the list.
  function onmousedown(event: MouseEvent) {
    if (owner === undefined) return
    event.preventDefault()
    const id = chosen(event)
    if (id !== undefined) onpick(id)
  }

  function onclick(event: MouseEvent) {
    if (owner !== undefined) return
    const id = chosen(event)
    if (id !== undefined) onpick(id)
  }
</script>

<div
  class="scroller"
  bind:this={scroller}
  {hidden}
  data-opened={openItem === undefined ? undefined : true}
  data-dimmed={dimmed || undefined}
  onscroll={() => (scrollTop = scroller.scrollTop)}
>
  {#if grouped && band && topGroup >= 0}
    <!-- The top row's band, staying while its rows pass under. Takes no room in the list. -->
    <div class="stays" aria-hidden="true"><div>{@render band(topGroup)}</div></div>
  {/if}
  <ol
    bind:this={list}
    id={`${idPrefix}-list`}
    role="listbox"
    aria-label={label}
    tabindex={owner === undefined ? 0 : -1}
    aria-activedescendant={owner === undefined ? descendant : undefined}
    style:--above="{offsets.top(shown.from)}px"
    style:--below="{offsets.top(count) - offsets.top(shown.to)}px"
    {onfocus}
    onkeydown={(event) => {
      // A field in a row (a refile) keeps its keys: the arrows are its list's, not the rows'.
      if (owner === undefined && event.target === event.currentTarget) press(event)
    }}
    {onmousedown}
    {onclick}
  >
    {#each drawn as { index, item } (item === undefined ? `#${index}` : idOf(item))}
      {@const starts = grouped?.starts(index) ?? false}
      {@const height = rows.top(index + 1) - rows.top(index)}
      {@const group = starts && grouped ? grouped.groupAt(index) : undefined}
      {#if item === undefined}
        <Row id={undefined} busy setsize={count} posinset={index + 1} {height} {band} {group} />
      {:else}
        {@const id = idOf(item)}
        {@const off = disabled?.(item) ?? false}
        <Row
          id={off ? undefined : optionId(id)}
          dataId={id}
          selected={id === active}
          disabled={off}
          written={id === written}
          setsize={count}
          posinset={index + 1}
          {columns}
          {height}
          {band}
          {group}
          room={index === openAt ? room : 0}
          hint={id === active && index !== openAt ? hint : undefined}
        >
          {@render row(item)}
        </Row>
      {/if}
    {/each}
  </ol>
  {#if details && openItem !== undefined}
    <div
      class="details"
      style:top="{rows.top(openAt + 1)}px"
      bind:offsetHeight={detailsHeight}
    >
      {@render details(openItem)}
    </div>
  {/if}
</div>

<style>
  .scroller {
    position: relative;
    min-height: 0;
    overflow-y: auto;
    /* Room for the scrollbar whether it shows or not, so the rows don't shift when it comes. */
    scrollbar-gutter: stable;
  }

  .scroller[hidden] {
    display: none;
  }

  /* As tall as its scroller at least, so an empty list is still a box to focus and click. */
  ol {
    min-block-size: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* The rows not drawn, as space inside the scroller: on its padding they'd make it taller. */
  ol::before,
  ol::after {
    content: '';
    display: block;
  }

  ol::before {
    block-size: var(--above);
  }

  ol::after {
    block-size: var(--below);
  }

  .stays {
    position: sticky;
    inset-block-start: 0;
    z-index: 1;
    block-size: 0;
  }

  .stays > div {
    position: absolute;
    inset-inline: 0;
  }

  /* The composer is open: the rest of the ledger isn't for reading, and reaching for it closes it. */
  .scroller[data-dimmed] > ol > :global(li) {
    opacity: 0.42;
  }

  .details {
    position: absolute;
    inset-inline: var(--space-2);
  }
</style>
