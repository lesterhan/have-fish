<script lang="ts">
  // A list with nothing in it: what to do, shown where the rows would be; or, where something is
  // still to come, the app's one line for it.
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
