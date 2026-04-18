<script lang="ts">
  interface Props {
    onclick: () => void
    "aria-label": string
    disabled?: boolean
    children: import("svelte").Snippet
  }

  let { onclick, "aria-label": ariaLabel, disabled = false, children }: Props = $props()
</script>

<button class="nav-btn" {onclick} {disabled} aria-label={ariaLabel}>
  {@render children()}
</button>

<style>
  .nav-btn {
    width: 24px;
    height: 22px;
    background: linear-gradient(180deg, #ffffff, var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    font-family: var(--font-serif);
    font-size: 16px;
    color: var(--color-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition:
      border-color var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .nav-btn:hover:not(:disabled) {
    background: linear-gradient(180deg, #ffffff, var(--color-accent-chip-bg));
    border-color: var(--color-accent);
  }

  .nav-btn:active:not(:disabled) {
    box-shadow: var(--shadow-sunken);
  }

  .nav-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: -3px;
  }

  .nav-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
