<script lang="ts">
  // The headings over a list's columns, laid out as its rows are. Each row's cells say what they
  // are to a screen reader, so the headings are for the eye. One over figures aligns to its end.
  type Heading = { name: string; end?: boolean }
  let { columns, names }: { columns: string; names: readonly Heading[] } = $props()
</script>

<div class="headings" aria-hidden="true" style:grid-template-columns={columns}>
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

  .end {
    justify-self: end;
  }
</style>
