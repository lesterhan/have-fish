<script lang="ts">
  let { children }: { children: import('svelte').Snippet } = $props()
</script>

<div class="form-grid">
  {@render children()}
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: 9rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .form-grid :global(label),
  .form-grid :global(.field-label) {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
    text-align: right;
  }

  .form-grid :global(input:not(.file-input)) {
    font-family: var(--font-mono);
    font-size: var(--text-body);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: var(--sp-3xs) var(--sp-xs);
    height: 24px;
    box-sizing: border-box;
    width: 100%;
    outline: none;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .form-grid :global(input:not(.file-input):focus) {
    border-color: var(--color-accent-hi);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.08),
      0 0 0 2px var(--color-accent-chip-bg);
  }

  .form-grid :global(select) {
    font-family: var(--font-mono);
    font-size: var(--text-body);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: var(--sp-3xs) var(--sp-xs);
    height: 24px;
    box-sizing: border-box;
    width: 100%;
    outline: none;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .form-grid :global(select:focus) {
    border-color: var(--color-accent-hi);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.08),
      0 0 0 2px var(--color-accent-chip-bg);
  }

  .form-grid :global(.required) {
    color: var(--color-danger);
    text-transform: none;
  }

  .form-grid :global(.optional) {
    color: var(--color-text-muted);
    font-weight: var(--weight-normal);
    text-transform: none;
    font-size: var(--text-micro);
  }

  .form-grid :global(.toggle-label) {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-content: flex-end;
  }
</style>
