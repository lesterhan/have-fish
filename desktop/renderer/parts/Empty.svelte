<script lang="ts">
  // A list with nothing in it: what to do, shown where the rows would be.
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<div class="empty">{@render children()}</div>

<style>
  .empty {
    padding: var(--space-4) 0;
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }
</style>
