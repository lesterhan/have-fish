<script lang="ts">
  import type { Snippet } from 'svelte'
  import Card from '$lib/components/ui/Card.svelte'

  /**
   * A collapsible titled card with a table in it — the repeating unit of both Accounts tabs.
   *
   * It exists because the two tabs had drifted. Same class names on both sides, different
   * values underneath: `--text-sm` against `--text-xs` rows, sans small-caps against mono
   * column headers, `--color-rule` against `--color-rule-soft` row rules, `transform:
   * rotate` against `rotate`, and a scattering of hard-coded 3px/4px/9px where the other
   * side used tokens. Switching tabs read as switching applications.
   *
   * So the card owns the chrome — the header bar, the disclosure, and the table's own
   * typography — and the tabs supply only their columns. The table styling reaches the
   * host's `<table>` through `:global`, scoped to this card's body, which is the one way
   * two components can share table chrome without a stylesheet that outlives its callers.
   */
  interface Props {
    label: string
    /** Rows in the section, shown beside the label. */
    count?: number
    /** Right-aligned figure — a balance, or an entry count. */
    total?: string
    /** Small suffix on the total: a currency code, or "entries". */
    unit?: string
    /** Quiet aside after the total — what a figure is leaving out. */
    note?: string
    /** Tooltip for the note, which is deliberately short enough to need one. */
    noteTitle?: string
    /** The host owns the fold state, keyed however it groups — so it survives a regroup. */
    collapsed?: boolean
    ontoggle?: () => void
    /** Extra class on the header button, for host state (e.g. a partial selection). */
    headerClass?: string
    /** Before the disclosure, outside the button: a group select-all checkbox. */
    lead?: Snippet
    /** After the disclosure, outside the button: a section-level action. */
    trailing?: Snippet
    children: Snippet
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
    headerClass = '',
    lead,
    trailing,
    children,
  }: Props = $props()
</script>

<Card class="section-card">
  <div class="header">
    <!-- `lead` sits outside the button on purpose: nesting a checkbox inside a button is
         invalid, and selecting a group should not also fold it away. -->
    {@render lead?.()}
    <button
      type="button"
      class="toggle {headerClass}"
      aria-expanded={!collapsed}
      onclick={ontoggle}
    >
      <img
        src="/icons/chevron-right-filled.svg"
        alt=""
        aria-hidden="true"
        width="12"
        height="12"
        class="chevron"
        class:open={!collapsed}
      />
      <span class="label">{label}</span>
      {#if count !== undefined}
        <span class="count">{count}</span>
      {/if}
      {#if total !== undefined}
        <span class="total">
          {total}
          {#if unit}<span class="unit">{unit}</span>{/if}
        </span>
      {/if}
      {#if note}
        <span class="note" title={noteTitle}>{note}</span>
      {/if}
    </button>
    {@render trailing?.()}
  </div>

  {#if !collapsed}
    <div class="body">{@render children()}</div>
  {/if}
</Card>

<style>
  :global(.card.section-card) {
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-section-bar-bg, var(--color-window));
    color: var(--color-section-bar-fg, var(--color-text));
    border-bottom: 1px solid var(--color-rule);
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
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition: filter var(--duration-fast) var(--ease);
  }

  .toggle:hover {
    filter: brightness(1.25);
  }

  .toggle:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 2px;
  }

  .chevron {
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .label {
    font-weight: var(--weight-semibold);
  }

  /* The section bar is dark in both themes, so anything secondary on it dims by opacity
     rather than by --color-text-muted, which is a dark grey and disappears against it. */
  .count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: inherit;
    opacity: 0.65;
  }

  .total {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .unit {
    font-size: var(--text-xs);
    color: inherit;
    opacity: 0.65;
    font-weight: var(--weight-normal);
  }

  .note {
    font-size: var(--text-xs);
    color: inherit;
    opacity: 0.75;
    font-style: italic;
  }

  /* --- The table the host puts inside --- *
     Scoped to this card's body, so it reaches the caller's markup without escaping into
     every table in the app. Column semantics that both tabs share live here too: `.num`
     for figures, `.actions` for the trailing button column. */
  .body {
    overflow-x: auto;
  }

  .body :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .body :global(th) {
    padding: var(--sp-xs) var(--sp-sm);
    text-align: left;
    font-weight: var(--weight-semibold);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border-bottom: 1px solid var(--color-rule);
  }

  .body :global(td) {
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule-soft);
    vertical-align: top;
  }

  .body :global(tbody tr:last-child td) {
    border-bottom: none;
  }

  .body :global(tbody tr:hover td) {
    background: var(--color-accent-light);
  }

  .body :global(th.num),
  .body :global(td.num) {
    text-align: right;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .body :global(th.actions),
  .body :global(td.actions) {
    width: 1%;
    white-space: nowrap;
    text-align: right;
  }

  .body :global(.muted) {
    color: var(--color-text-muted);
  }
</style>
