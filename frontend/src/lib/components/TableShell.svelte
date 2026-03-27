<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Column {
    label: string
    class?: string
  }

  interface Props {
    columns: Column[]
    loading?: boolean
    empty?: boolean
    emptyText?: string
    children: Snippet
  }

  let {
    columns,
    loading = false,
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
      <tr>
        <td colspan={columns.length} class="status-cell loading">Loading…</td>
      </tr>
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

  .status-cell.loading {
    color: transparent;
    background: linear-gradient(
      90deg,
      var(--color-window)       0%,
      var(--color-window-inset) 40%,
      var(--color-window)       60%,
      var(--color-window)       100%
    );
    background-size: 300% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%   { background-position: 200% center; }
    100% { background-position: -100% center; }
  }
</style>
