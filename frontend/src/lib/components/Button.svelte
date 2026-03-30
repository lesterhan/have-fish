<script lang="ts">
  interface Props {
    variant?: 'default' | 'primary' | 'danger' | 'ghost'
    disabled?: boolean
    square?: boolean
    type?: 'button' | 'submit' | 'reset'
    title?: string
    'aria-label'?: string
    onclick?: () => void
    children: import('svelte').Snippet
  }

  let {
    variant = 'default',
    disabled = false,
    square = false,
    type = 'button',
    title,
    'aria-label': ariaLabel,
    onclick,
    children,
  }: Props = $props()
</script>

<button
  {type}
  {disabled}
  {title}
  aria-label={ariaLabel}
  {onclick}
  class="btn {variant}"
  class:square
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

    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .btn:hover:not(:disabled) {
    background: var(--color-window-raised);
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

  .btn.square {
    min-width: 0;
    padding: 3px var(--sp-xs);
  }

  /* Ghost — no background or bevel, dashed outline on hover like editable fields */
  .btn.ghost {
    background: transparent;
    box-shadow: none;
    color: var(--color-text-muted);
    outline: 1px dashed transparent;
    outline-offset: 1px;
    transition: outline-color var(--duration-fast) var(--ease);
  }

  .btn.ghost:hover:not(:disabled) {
    background: transparent;
    color: var(--color-text);
    box-shadow: none;
    outline-color: var(--color-text-muted);
  }

  .btn.ghost:active:not(:disabled) {
    background: transparent;
    box-shadow: none;
    padding-top: 3px;
    padding-left: var(--sp-xs);
  }

  /* Primary — default action in a dialog, XP blue */
  .btn.primary {
    font-weight: var(--weight-semibold);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--color-window-raised);
  }

  .btn.primary:active:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-text-on-dark);
    box-shadow: var(--shadow-sunken);
  }

  /* Danger — destructive actions */
  .btn.danger:hover:not(:disabled) {
    background: var(--color-window-raised);
  }

  .btn.danger:active:not(:disabled) {
    background: var(--color-danger);
    color: var(--color-text-on-dark);
    box-shadow: var(--shadow-sunken);
  }
</style>
