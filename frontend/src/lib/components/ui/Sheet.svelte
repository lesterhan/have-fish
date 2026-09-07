<script lang="ts" module>
  import type { Snippet } from 'svelte'

  export type SheetColumn = {
    /** Stable identity, and the class the host puts on its cells. */
    key: string
    label: string
    /**
     * Column width. Exactly one column should omit it — that one takes the remainder and is
     * the column the row is *about*. See WIDTH for the shared vocabulary.
     */
    width?: string
    /** Right-aligned mono. Figures line up on their last digit or they are not a column. */
    numeric?: boolean
    /** The header cell is for screen readers only — a column of controls has no name to show. */
    unlabelled?: boolean
  }

  /**
   * The shared width vocabulary.
   *
   * Two tables on the same route drifting apart is what `SectionCard` was written to stop,
   * and it stopped it by owning the typography while each caller sized its own columns —
   * which left the widths free to drift instead. Naming them here is the same idea applied
   * to the thing that actually moved.
   */
  export const WIDTH = {
    /** A figure with a currency tag on it. */
    money: '13rem',
    /** A converted figure — no tag, so narrower. */
    converted: '9.5rem',
    /** An ISO date, plus room for a "stale 40d" aside under it. */
    date: '9.5rem',
    /** A small count. */
    count: '7rem',
    /** A type or status chip. */
    chip: '7rem',
    /** Chips that accumulate: pinned, hidden, managed, an attention count. */
    flags: '13rem',
    /** Trailing icon buttons. */
    actions: '7.5rem',
  } as const
</script>

<script lang="ts">
  import { setContext } from 'svelte'

  /**
   * One sheet, one column geometry.
   *
   * The Accounts page used to render a separate `<table width="100%">` per group, so every
   * group sized its columns from its own content and Balance sat at a different x in Bank,
   * Equity and Receivable. Three tables that look like one table but do not line up are
   * worse than three tables that look like three, because the eye is invited to scan down a
   * column that is not there.
   *
   * So there is one table, `table-layout: fixed`, widths declared once in a `<colgroup>`,
   * and groups are *rows in it* rather than tables of their own — see `SheetBand`. The
   * header appears once, at the top, because a repeated header is a repeated question.
   */
  interface Props {
    columns: SheetColumn[]
    /** Announced by screen readers; the visible title belongs to the page or a band. */
    caption: string
    /** `<tr>` rows and `SheetBand`s. */
    children: Snippet
  }

  let { columns, caption, children }: Props = $props()

  /**
   * The narrowest the sheet may be squeezed before it scrolls instead.
   *
   * `table-layout: fixed` gives the un-sized column whatever is left over, and "whatever is
   * left over" can be zero: on a phone the fixed columns alone already overflowed the
   * viewport, so the account name — the thing every row is about — was allocated no width at
   * all and the header read as ACCOUNT and TYPE printed on top of each other. Summing the
   * declared widths and adding a floor for the flexible column means the sheet scrolls, which
   * is the honest failure, rather than eating its own first column.
   */
  const FLEXIBLE_FLOOR = '14rem'

  let minWidth = $derived.by(() => {
    const fixed = columns.map((c) => c.width).filter((w): w is string => !!w)
    const parts = columns.some((c) => !c.width)
      ? [FLEXIBLE_FLOOR, ...fixed]
      : fixed
    return parts.length ? `calc(${parts.join(' + ')})` : undefined
  })

  // Bands and drawers span the whole sheet, and neither can count the columns itself.
  setContext('sheet', {
    get columnCount() {
      return columns.length
    },
  })
</script>

<div class="sheet-scroll">
  <table class="sheet" style:min-width={minWidth}>
    <caption class="sr-only">{caption}</caption>
    <colgroup>
      {#each columns as column (column.key)}
        <col style={column.width ? `width: ${column.width}` : undefined} />
      {/each}
    </colgroup>
    <thead>
      <tr>
        {#each columns as column (column.key)}
          <th class:num={column.numeric} class={column.key}>
            {#if column.unlabelled}
              <span class="sr-only">{column.label}</span>
            {:else}
              {column.label}
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {@render children()}
    </tbody>
  </table>
</div>

<style>
  .sheet-scroll {
    /* Wide content scrolls inside its own box; the page never scrolls sideways. */
    overflow-x: auto;
    background: var(--color-window);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--card-shadow);
  }

  .sheet {
    /* The whole point. Without it a cell's content re-sizes its column, which is how the
       per-group tables drifted even when they declared the same widths. */
    table-layout: fixed;
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th {
    height: 27px;
    padding: 0 var(--sp-sm);
    text-align: left;
    font-weight: var(--weight-semibold);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
  }

  th.num {
    text-align: right;
  }

  /* --- What the host's rows get ---
     Reaching the caller's `<tr>`s through `:global`, scoped to this sheet. The alternative
     is a stylesheet that outlives its callers. */

  .sheet :global(td) {
    /* 33px: the density the design pass settled on. `height` on a cell is a minimum, so a
       row with a second line under the name grows rather than clipping. */
    height: 33px;
    padding: 0 var(--sp-sm);
    border-bottom: 1px solid var(--color-rule-soft);
    vertical-align: middle;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sheet :global(tbody tr:last-child td) {
    border-bottom: none;
  }

  .sheet :global(tbody tr:hover td) {
    background: var(--color-window-raised);
  }

  .sheet :global(td.num) {
    text-align: right;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .sheet :global(td.actions) {
    white-space: nowrap;
    text-align: right;
  }

  .sheet :global(.muted) {
    color: var(--color-text-muted);
  }

  /* A row that opens something below it: the thing below supplies its own padding, and a
     33px floor on a drawer would be a 33px gap under a one-line drawer. */
  .sheet :global(tr.spanning td) {
    height: auto;
    padding: 0;
    overflow: visible;
  }
</style>
