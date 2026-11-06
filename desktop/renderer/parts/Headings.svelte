<script lang="ts">
  // The headings over a list's columns, laid out as its rows are. Each row's cells say what they
  // are to a screen reader, so the headings are for the eye.
  let { columns, names }: { columns: string; names: readonly string[] } = $props()
</script>

<div class="headings" aria-hidden="true" style:grid-template-columns={columns}>
  {#each names as name, i (i)}<span>{name}</span>{/each}
</div>

<style>
  .headings {
    display: grid;
    column-gap: var(--space-3);
    align-items: end;
    padding: var(--space-2);
    font-size: var(--text-small);
    font-weight: var(--weight-label);
    color: var(--color-muted);
    border-block-end: var(--border-width) solid var(--color-rule);
  }
</style>
