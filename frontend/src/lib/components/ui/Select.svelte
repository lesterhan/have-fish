<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements'
  import type { Snippet } from 'svelte'

  interface Props extends HTMLSelectAttributes {
    value?: string
    children: Snippet
  }

  let { value = $bindable(''), children, class: className = '', ...restProps }: Props = $props()
</script>

<select class="select-input {className}" bind:value {...restProps}>
  {@render children()}
</select>

<style>
  .select-input {
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

  .select-input:focus {
    border-color: var(--color-accent-mid);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 2px var(--color-accent-light);
  }

  .select-input:disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }
</style>
