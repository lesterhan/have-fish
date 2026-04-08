<script lang="ts">
  let { children }: { children: import('svelte').Snippet } = $props()
</script>

<div class="form-grid">
  {@render children()}
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .form-grid :global(label),
  .form-grid :global(.field-label) {
    font-size: var(--text-sm);
    text-align: right;
  }

  .form-grid :global(input:not(.file-input)) {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid :global(input:not(.file-input):focus) {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .form-grid :global(select) {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid :global(select:focus) {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .form-grid :global(.required) {
    color: var(--color-amount-negative);
  }

  .form-grid :global(.optional) {
    color: var(--color-text-muted);
    font-weight: normal;
  }

  .form-grid :global(.toggle-label) {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-content: flex-end;
  }

  .form-grid :global(.tooltip-icon) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-text-muted);
    color: var(--color-window);
    font-size: 10px;
    font-weight: bold;
    cursor: help;
    flex-shrink: 0;
  }
</style>
