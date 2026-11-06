<script lang="ts" generics="T">
  // Every list in the app: its roles, `aria-activedescendant`, the keys, a click by id, and only
  // the rows in view drawn, with the space above and below them kept so the scrollbar is the
  // whole list's. A list is `items`, or `paged` when the window holds only some of it (see #608).
  // Rows can come in groups, each under a band, and the top one's band stays while its rows pass
  // under it (see #611). The rules are in `listbox.ts`; each row is a `Row`.
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
    wrap = false,
    owner,
    hidden = false,
  }: Props = $props()

  let list: HTMLOListElement
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
  const offsets: Layout = $derived(
    grouped ??
      (items && height
        ? offsetsOf(items.map((item) => height(item, rowHeight)))
        : uniformOf(count, rowHeight)),
  )
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
  const at = $derived(
    active === null ? -1 : positions ? (positions.get(active) ?? -1) : (paged?.indexOf(active) ?? -1),
  )
  /** Named only while drawn: scrolled out, the list has no element to point at. */
  const descendant = $derived(at >= shown.from && at < shown.to ? optionId(active) : undefined)

  function optionId(id: string | null) {
    return id === null ? undefined : `${idPrefix}-${id}`
  }

  export function focus() {
    list.focus()
  }

  onMount(() => {
    const css = (name: string) => Number.parseFloat(getComputedStyle(list).getPropertyValue(name))
    if (css('--row') > 0) rowHeight = css('--row')
    if (css('--band') > 0) bandHeight = css('--band')
    const resized = new ResizeObserver(() => (viewport = list.clientHeight))
    resized.observe(list)
    return () => resized.disconnect()
  })

  // The keys move the active item past what's drawn; the list scrolls to keep it in view. Only
  // when the active item changes: a page arriving with it in mustn't pull the list back to it.
  $effect(() => {
    void active
    untrack(() => {
      const index = at
      const to = scrolledTo(offsets, index, list.scrollTop, viewport || list.clientHeight, covered)
      if (to !== list.scrollTop) list.scrollTop = scrollTop = to
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
    const to = movedTo(offsets, at, event.key, viewport || list.clientHeight, {
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

<ol
  bind:this={list}
  id={`${idPrefix}-list`}
  role="listbox"
  aria-label={label}
  tabindex={owner === undefined ? 0 : -1}
  aria-activedescendant={owner === undefined ? descendant : undefined}
  {hidden}
  style:--above="{offsets.top(shown.from)}px"
  style:--below="{offsets.top(count) - offsets.top(shown.to)}px"
  onkeydown={(event) => {
    if (owner === undefined) press(event)
  }}
  onscroll={() => (scrollTop = list.scrollTop)}
  {onmousedown}
  {onclick}
>
  {#if grouped && band && topGroup >= 0}
    <!-- The top row's band, staying while its rows pass under. Takes no room in the list. -->
    <div class="stays" aria-hidden="true"><div>{@render band(topGroup)}</div></div>
  {/if}
  {#each drawn as { index, item } (item === undefined ? `#${index}` : idOf(item))}
    {@const starts = grouped?.starts(index) ?? false}
    {@const height = offsets.top(index + 1) - offsets.top(index)}
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
        hint={id === active ? hint : undefined}
      >
        {@render row(item)}
      </Row>
    {/if}
  {/each}
</ol>

<style>
  ol {
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
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

  ol[hidden] {
    display: none;
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
</style>
