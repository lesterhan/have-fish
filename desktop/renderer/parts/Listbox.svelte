<script lang="ts" generics="T">
  // Every list in the app: its roles, `aria-activedescendant`, the keys, a click by id, and only
  // the rows in view drawn, with the space above and below them kept so the scrollbar is the
  // whole list's. A list is `items`, or `paged` when the window holds only some of it (see #608).
  // The rules are in `listbox.ts`.
  import { onMount, type Snippet, untrack } from 'svelte'
  import { movedTo, offsetsOf, type Paged, scrolledTo, uniformOf, windowOf } from './listbox'

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
  /** `--row` from the stylesheet, so density changes it there and only there. */
  let rowHeight = $state(33)

  const count = $derived(items?.length ?? paged?.count ?? 0)
  const itemAt = (i: number): T | undefined => (items ? items[i] : paged?.at(i))
  // Rows of one height are worked out, not stored, so a paged list costs nothing per row.
  const offsets = $derived(
    items && height
      ? offsetsOf(items.map((item) => height(item, rowHeight)))
      : uniformOf(count, rowHeight),
  )
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
    const css = Number.parseFloat(getComputedStyle(list).getPropertyValue('--row'))
    if (css > 0) rowHeight = css
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
      const to = scrolledTo(offsets, index, list.scrollTop, viewport || list.clientHeight)
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
  {#each drawn as { index, item } (item === undefined ? `#${index}` : idOf(item))}
    {#if item === undefined}
      <!-- A row of a paged list on its way: its place, so the rows below don't move. -->
      <li
        role="option"
        aria-selected="false"
        aria-busy="true"
        aria-setsize={count}
        aria-posinset={index + 1}
        style:block-size="{rowHeight}px"
      ></li>
    {:else}
      {@const id = idOf(item)}
      {@const off = disabled?.(item) ?? false}
      <li
        id={off ? undefined : optionId(id)}
        role="option"
        aria-selected={id === active}
        aria-disabled={off || undefined}
        aria-setsize={count}
        aria-posinset={index + 1}
        data-id={id}
        style:grid-template-columns={columns}
        style:block-size="{height?.(item, rowHeight) ?? rowHeight}px"
      >
        {@render row(item)}
      </li>
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

  li {
    display: grid;
    align-items: center;
    column-gap: var(--space-3);
    box-sizing: border-box;
    padding-inline: var(--space-2);
    border-block-end: var(--border-width) solid var(--color-rule);
    overflow: hidden;
    cursor: default;
  }

  li[aria-selected='true'] {
    background: var(--color-selected);
  }

  li[aria-disabled='true'] {
    color: var(--color-muted);
  }
</style>
