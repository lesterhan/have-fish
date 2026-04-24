<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'

  interface Props extends HTMLButtonAttributes {
    variant?: 'default' | 'close' | 'minimize' | 'maximize'
  }

  let { variant = 'default', children, class: className = '', ...restProps }: Props = $props()
</script>

<button class="chrome-btn {variant} {className}" {...restProps}>
  {@render children?.()}
</button>

<style>
  .chrome-btn {
    width: 21px;
    height: 21px;
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
    color: var(--color-text);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .chrome-btn:hover {
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-accent-chip-bg));
    border-color: var(--color-accent);
  }

  .chrome-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .chrome-btn.close:hover {
    background: linear-gradient(180deg, #ff8080, var(--color-danger));
    border-color: var(--color-danger);
    color: var(--color-btn-gradient-hi);
  }

  .chrome-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: -2px;
  }
</style>
