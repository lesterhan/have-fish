<script lang="ts">
  interface Props {
    value?: string
    placeholder?: string
    required?: boolean
    disabled?: boolean
    id?: string
    type?: 'text' | 'email' | 'password' | 'search'
    style?: string
  }

  let {
    value = $bindable(''),
    placeholder = '',
    required = false,
    disabled = false,
    id,
    type = 'text',
    style,
  }: Props = $props()
</script>

<input
  {id}
  {type}
  {placeholder}
  {required}
  {disabled}
  {style}
  class="text-input"
  bind:value
/>

<style>
  .text-input {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 2px var(--sp-xs);
    height: 22px;
    outline: none;
    transition: outline var(--duration-fast) var(--ease);
  }

  .text-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .text-input:disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }
</style>
