<script lang="ts">
  interface Props {
    variant?: 'default' | 'primary' | 'danger'
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    onclick?: () => void
    children: import('svelte').Snippet
  }

  let {
    variant = 'default',
    disabled = false,
    type = 'button',
    onclick,
    children,
  }: Props = $props()
</script>

<button
  {type}
  {disabled}
  {onclick}
  class="btn {variant}"
>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-xs);
    padding: 3px var(--sp-md);
    min-width: 75px;
    height: 23px;

    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
    color: var(--color-text);

    background: var(--color-window);
    border: none;
    box-shadow: var(--shadow-raised);

    cursor: pointer;
    user-select: none;

    transition:
      box-shadow var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .btn:hover:not(:disabled) {
    background: var(--color-accent-light);
  }

  .btn:active:not(:disabled) {
    box-shadow: var(--shadow-sunken);
    /* nudge content 1px to sell the press */
    padding-top: 4px;
    padding-left: calc(var(--sp-md) + 1px);
  }

  .btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: -4px;
  }

  .btn:disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
    box-shadow: var(--shadow-raised);
    opacity: 0.7;
  }

  /* Primary — default action in a dialog, XP blue */
  .btn.primary {
    background: var(--color-accent-light);
    font-weight: var(--weight-semibold);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--color-accent-mid);
    color: var(--color-text-on-dark);
  }

  .btn.primary:active:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-text-on-dark);
    box-shadow: var(--shadow-sunken);
  }

  /* Danger — destructive actions */
  .btn.danger:hover:not(:disabled) {
    background: var(--color-danger-light);
    color: var(--color-danger);
  }

  .btn.danger:active:not(:disabled) {
    background: var(--color-danger);
    color: var(--color-text-on-dark);
    box-shadow: var(--shadow-sunken);
  }
</style>
