<script lang="ts">
  // One option of a Listbox, and its states (DESIGN.md, "Parts"): at rest; a lighter step under
  // the pointer; selected, a tint, with an accent edge and its keys while its list has focus;
  // landed, lit where it lands; open, lifted with its details under it, while the rest of the
  // list steps back. A row that starts a day carries the day's band above it.
  import type { Snippet } from 'svelte'

  type Props = {
    /** The element id `aria-activedescendant` names; none while it can't be chosen. */
    id: string | undefined
    /** The item's id, which a click reads. */
    dataId?: string | undefined
    selected?: boolean
    disabled?: boolean
    /** Its page hasn't arrived: an empty row, so the rows below don't move. */
    busy?: boolean
    /** Landing on its day: the selection tint and the accent edge, fading where it lands. */
    landed?: boolean
    /** Its landing light has faded. */
    onlanded?: (() => void) | undefined
    setsize: number
    posinset: number
    columns?: string | undefined
    /** Its whole height in px, its band's included. */
    height: number
    /** The band of `group`, when the row starts it. */
    band?: Snippet<[number]> | undefined
    group?: number | undefined
    /** Open: the room under it its details take, in px; 0 when it's closed. */
    room?: number
    /** Shown while it's selected and its list has focus: what its keys do. */
    hint?: Snippet | undefined
    children?: Snippet | undefined
  }
  let {
    id,
    dataId,
    selected = false,
    disabled = false,
    busy = false,
    landed = false,
    onlanded,
    setsize,
    posinset,
    columns,
    height,
    band,
    group,
    room = 0,
    hint,
    children,
  }: Props = $props()
</script>

<li
  {id}
  role="option"
  aria-selected={selected}
  aria-disabled={disabled || undefined}
  aria-busy={busy || undefined}
  aria-setsize={setsize}
  aria-posinset={posinset}
  data-id={dataId}
  data-landed={landed || undefined}
  class:banded={band !== undefined && group !== undefined}
  class:open={room > 0}
  style:grid-template-columns={columns}
  style:block-size="{height}px"
  style:margin-block-end={room > 0 ? `${room}px` : undefined}
  onanimationend={(event) => {
    if (landed && event.target === event.currentTarget) onlanded?.()
  }}
>
  {#if band && group !== undefined}<div class="band">{@render band(group)}</div>{/if}
  {@render children?.()}
  {#if hint && selected}<span class="hint">{@render hint()}</span>{/if}
</li>

<style>
  li {
    position: relative;
    display: grid;
    align-items: center;
    column-gap: var(--space-3);
    box-sizing: border-box;
    padding-inline: var(--space-2);
    border-block-end: var(--border-width) solid var(--color-rule);
    overflow: hidden;
    cursor: default;
  }

  /* A cell too long for its column ends in an ellipsis. */
  li > :global(*:not(.band, .hint)) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  li.banded {
    grid-template-rows: var(--band) 1fr;
  }

  .band {
    grid-column: 1 / -1;
    align-self: stretch;
    margin-inline: calc(-1 * var(--space-2));
  }

  li:hover {
    background: var(--color-band);
  }

  li[aria-selected='true'] {
    background: var(--color-selected);
  }

  :global(ol:focus) > li[aria-selected='true'] {
    box-shadow: inset 3px 0 0 var(--color-accent);
  }

  /* Open: the row is the top of a tile with its details, inset and lifted (DESIGN.md, "Card"). */
  li.open {
    isolation: isolate;
    border-block-end-color: transparent;
  }

  li.open,
  li.open:hover,
  :global(ol:focus) > li.open[aria-selected='true'] {
    background: none;
    box-shadow: none;
  }

  li.open::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: var(--space-1) var(--space-2) 0;
    border-radius: var(--radius-card) var(--radius-card) 0 0;
    background: var(--color-selected);
    box-shadow: var(--shadow-lift);
  }

  li.open.banded::before {
    inset-block-start: var(--band);
  }

  /* The rest of the list, while a row is open: not for reading, and reaching for it closes it. */
  :global([data-opened] > ol) > li:not(.open) {
    opacity: 0.5;
  }

  li[aria-disabled='true'] {
    color: var(--color-muted);
  }

  li[data-landed] {
    animation: land var(--duration-land) var(--ease-out);
  }

  @keyframes land {
    from {
      background: var(--color-selected);
      box-shadow: inset 3px 0 0 var(--color-accent);
    }
  }

  .hint {
    position: absolute;
    inset-inline-end: var(--space-2);
    inset-block-end: 0;
    block-size: var(--row);
    display: none;
    align-items: center;
    gap: var(--space-1);
    padding-inline-start: var(--space-2);
    font-size: var(--text-small);
    color: var(--color-muted);
    background: var(--color-selected);
  }

  :global(ol:focus) > li > .hint {
    display: flex;
  }
</style>
