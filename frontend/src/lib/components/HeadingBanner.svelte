<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
  }

  let { children }: Props = $props()
</script>

<div class="heading-banner">
  {@render children()}
</div>

<style>
  .heading-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-md) var(--sp-lg);
    margin-bottom: var(--sp-xl);
    background: linear-gradient(to right, var(--color-banner-from), var(--color-banner-to));
    box-shadow: var(--shadow-window);
  }

  .heading-banner :global(h1) {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--color-titlebar-text);
    letter-spacing: 0.02em;
  }
</style>
