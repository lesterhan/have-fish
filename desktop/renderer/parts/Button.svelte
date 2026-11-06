<script lang="ts">
  // A button: primary (one per place at most), plain, or quiet. With an action it shows that
  // action's keycap and says its shortcut to a screen reader.
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { KeyedActionId } from '../../shared/actions'
  import { ariaShortcut, MAC } from '../shortcuts'
  import Keys from './Keys.svelte'

  type Props = HTMLButtonAttributes & {
    variant?: 'primary' | 'plain' | 'quiet'
    action?: KeyedActionId
    children: Snippet
  }
  let { variant = 'plain', action, children, type = 'button', ...rest }: Props = $props()
  let element: HTMLButtonElement

  export function focus() {
    element.focus()
  }
</script>

<button
  bind:this={element}
  {type}
  class={variant}
  aria-keyshortcuts={action && ariaShortcut(action, MAC)}
  {...rest}
>
  {@render children()}
  {#if action}<Keys {action} />{/if}
</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    font: inherit;
    color: var(--color-text);
    background: var(--color-background);
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--color-accent);
  }

  button:active {
    transform: translateY(1px);
    box-shadow: var(--shadow-pressed);
  }

  .primary {
    border-color: var(--color-accent);
    font-weight: var(--weight-label);
    color: var(--color-on-accent);
    background: var(--color-accent);
  }

  .primary:hover {
    border-color: var(--color-accent-hover);
    background: var(--color-accent-hover);
  }

  .quiet {
    padding-inline: var(--space-2);
    border-color: transparent;
    color: var(--color-muted);
    background: transparent;
  }

  .quiet:hover {
    border-color: transparent;
    color: var(--color-text);
  }

  button:disabled,
  button[aria-disabled='true'] {
    opacity: 0.5;
    transform: none;
    box-shadow: none;
    cursor: default;
  }

  button:disabled:hover,
  button[aria-disabled='true']:hover {
    border-color: var(--color-border);
  }
</style>
