<script lang="ts">
  import type { Snippet } from 'svelte'
  import Shimmer from '$lib/components/Shimmer.svelte'

  interface Column {
    label: string
    class?: string
  }

  interface Props {
    columns: Column[]
    loading?: boolean
    loadingRows?: number
    empty?: boolean
    emptyText?: string
    children: Snippet
  }

  let {
    columns,
    loading = false,
    loadingRows = 3,
    empty = false,
    emptyText = 'No results.',
    children,
  }: Props = $props()
</script>

<table>
  <thead>
    <tr>
      {#each columns as col}
        <th class={col.class}>{col.label}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#if loading}
      {#each { length: loadingRows } as _}
        <tr>
          {#each columns as _col}
            <td class="shimmer-cell"><Shimmer height="0.875rem" /></td>
          {/each}
        </tr>
      {/each}
    {:else if empty}
      <tr>
        <td colspan={columns.length} class="status-cell">{emptyText}</td>
      </tr>
    {:else}
      {@render children()}
    {/if}
  </tbody>
</table>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    padding: var(--sp-xs) var(--sp-sm);
    text-align: left;
    font-weight: var(--weight-semibold);
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .status-cell {
    padding: var(--sp-sm);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .shimmer-cell {
    padding: var(--sp-xs) var(--sp-sm);
  }
</style>
