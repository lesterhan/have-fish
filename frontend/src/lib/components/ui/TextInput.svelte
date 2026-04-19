<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends HTMLInputAttributes {
    value?: string
  }

  let { value = $bindable(''), class: className = '', ...restProps }: Props = $props()
</script>

<input class="text-input {className}" bind:value {...restProps} />

<style>
  .text-input {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: 3px var(--sp-xs);
    height: 24px;
    box-sizing: border-box;
    outline: none;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .text-input:focus {
    border-color: var(--color-accent-mid);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 2px var(--color-accent-light);
  }

  .text-input:disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }
</style>
