<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">{title}</span>
  </div>
  <div class="panel-body">
    {@render children()}
  </div>
</div>

<style>
  .panel {
    border-radius: var(--radius-xl);
    box-shadow:
      var(--shadow-raised),
      2px 2px 0 rgba(0, 0, 0, 0.3);
    margin-bottom: var(--sp-xl);
  }

  .panel-header {
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding: 3px var(--sp-sm);
    background: linear-gradient(
      to right,
      var(--color-panel-header-from),
      var(--color-panel-header-to)
    );
    user-select: none;
  }

  .panel-title {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-panel-header-text);
  }

  .panel-body {
    background: var(--color-window-raised);
  }
</style>
