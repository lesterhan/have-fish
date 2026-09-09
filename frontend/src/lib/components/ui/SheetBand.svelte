<script lang="ts">
  import { getContext } from 'svelte'
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  /**
   * A group header, as a row of the sheet rather than a card around one.
   *
   * This is the change that makes the columns line up: when a group owns a `<table>`, it
   * owns a column geometry too, and three groups mean three geometries. A band spans the
   * sheet it lives in, so the rows under it inherit the one set of widths above it.
   *
   * It is one rung off the surface it heads and carries ordinary ink (DESIGN.md §5). The
   * dark gradient slab it replaces was the loudest thing on the page and never the thing
   * anyone came to read.
   */
  interface Props {
    label: string
    /** Rows in the group. */
    count?: number
    /** Right-aligned figure — the group's total. */
    total?: string
    /** Small suffix on the total: a currency code, or "entries". */
    unit?: string
    /** Quiet aside after the total — what the figure is leaving out. */
    note?: string
    /** Tooltip for the note, which is deliberately short enough to need one. */
    noteTitle?: string
    collapsed?: boolean
    ontoggle?: () => void
    /** A group-level control, after the total. */
    trailing?: Snippet
  }

  let {
    label,
    count,
    total,
    unit,
    note,
    noteTitle,
    collapsed = false,
    ontoggle,
    trailing,
  }: Props = $props()

  const sheet = getContext<{ columnCount: number }>('sheet')
</script>

<tr class="band spanning">
  <td class="section-bar" colspan={sheet.columnCount}>
    <div class="band-inner">
      <button
        type="button"
        class="toggle"
        aria-expanded={!collapsed}
        onclick={ontoggle}
      >
        <span class="chevron" class:open={!collapsed}>
          <Icon name="chevron-right-filled" size={12} />
        </span>
        <span class="label">{label}</span>
        {#if count !== undefined}
          <span class="count">{count}</span>
        {/if}
      </button>
      {#if total !== undefined}
        <span class="total">
          {total}
          {#if unit}<span class="unit">{unit}</span>{/if}
        </span>
      {/if}
      {#if note}
        <span class="note" title={noteTitle}>{note}</span>
      {/if}
      {@render trailing?.()}
    </div>
  </td>
</tr>

<style>
  /* The first band sits directly under the column header, which already draws a rule. */
  :global(thead + tbody) .band:first-child td {
    border-top: none;
  }

  .band-inner {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    height: 29px;
    padding: 0 var(--sp-sm);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font-family: var(--font-sans);
    font-size: var(--text-body);
    text-align: left;
    cursor: pointer;
  }

  .toggle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .chevron {
    display: flex;
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .label {
    font-weight: var(--weight-bold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The band is a surface now rather than a dark slab, so secondary text on it can use the
     muted ink like everything else — it used to dim by opacity because --color-text-muted
     vanished against the old gradient. */
  .count,
  .unit,
  .note {
    color: var(--color-text-muted);
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-dense);
  }

  .total {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-body);
    white-space: nowrap;
  }

  .unit {
    font-size: var(--text-dense);
    font-weight: var(--weight-normal);
  }

  .note {
    font-size: var(--text-dense);
    font-style: italic;
    white-space: nowrap;
  }
</style>
