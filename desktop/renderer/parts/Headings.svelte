<script lang="ts">
  // The headings over a list's columns, laid out as its rows are. Each row's cells say what they
  // are to a screen reader, so the headings are for the eye. One over figures aligns to its end.
  // Dimmed with their list, when it steps back.
  type Heading = { name: string; end?: boolean }
  type Props = { columns: string; names: readonly Heading[]; dimmed?: boolean }
  let { columns, names, dimmed = false }: Props = $props()
</script>

<div
  class="headings"
  aria-hidden="true"
  data-dimmed={dimmed || undefined}
  style:grid-template-columns={columns}
>
  {#each names as { name, end }, i (i)}<span class:end>{name}</span>{/each}
</div>

<style>
  .headings {
    display: grid;
    column-gap: var(--space-3);
    align-items: end;
    padding: var(--space-2);
    border-block-end: var(--border-width) solid var(--color-rule);
    /* The list's scrollbar takes its width at the end; the headings keep the same. */
    overflow: hidden;
    scrollbar-gutter: stable;
  }

  /* On the cells, so a column in `em` is as wide as the rows' below. */
  span {
    font-size: var(--text-small);
    font-weight: var(--weight-label);
    color: var(--color-muted);
  }

  /* As the list's rows step back (Listbox). */
  .headings[data-dimmed] > span {
    filter: var(--step-back);
  }

  .end {
    justify-self: end;
  }
</style>
