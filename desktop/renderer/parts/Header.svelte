<script lang="ts">
  // A place's header: its title, a quiet line, and at most one primary button.
  import type { Snippet } from 'svelte'

  type Props = { title: string; line?: string; children?: Snippet }
  let { title, line, children }: Props = $props()
</script>

<header>
  <h1>{title}</h1>
  {#if line}<p>{line}</p>{/if}
  {#if children}<span class="act">{@render children()}</span>{/if}
</header>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--text-title);
    font-weight: var(--weight-strong);
  }

  p {
    margin: 0;
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  .act {
    margin-inline-start: auto;
  }
</style>
