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
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.10);
    padding: 2px var(--sp-xs);
    height: 22px;
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
