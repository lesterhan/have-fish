<script lang="ts">
  // A floating layer where you read from it: opaque, lifted, and fading in 4px down. The place
  // that shows it decides where it sits; this part owns how it looks and moves.
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<div class="popover">{@render children()}</div>

<style>
  .popover {
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    background: var(--color-background);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    animation: pop var(--duration-pop) var(--ease-out);
  }

  @keyframes pop {
    from {
      opacity: 0;
      translate: 0 calc(-1 * var(--space-1));
    }
  }
</style>
