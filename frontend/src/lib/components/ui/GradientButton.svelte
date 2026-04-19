<script lang="ts">
  import { tooltip as tooltipAction } from "$lib/tooltip"

  interface Props {
    onclick?: () => void
    "aria-label"?: string
    disabled?: boolean
    active?: boolean
    square?: boolean
    tooltip?: string
    variant?: "default" | "warning"
    type?: "button" | "submit" | "reset"
    children: import("svelte").Snippet
  }

  let {
    onclick,
    "aria-label": ariaLabel,
    disabled = false,
    active = false,
    square = false,
    tooltip,
    variant = "default",
    type = "button",
    children,
  }: Props = $props()
</script>

<button
  {type}
  {disabled}
  {onclick}
  aria-label={ariaLabel}
  aria-pressed={active ? true : undefined}
  use:tooltipAction={{ label: tooltip ?? "", always: true }}
  class="btn"
  class:square
  class:active
  class:warning={variant === "warning"}
>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 24px;
    padding: 0 10px;
    background: linear-gradient(180deg, #ffffff, var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text);
    cursor: pointer;
    line-height: 1;
    user-select: none;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .btn.square {
    width: 24px;
    padding: 0;
  }

  .btn:hover:not(:disabled):not(.active) {
    background: linear-gradient(180deg, #ffffff, var(--color-accent-chip-bg));
    border-color: var(--color-accent);
  }

  .btn:active:not(:disabled) {
    box-shadow: var(--shadow-sunken);
  }

  .btn.active {
    background: linear-gradient(
      180deg,
      var(--color-accent),
      color-mix(in srgb, var(--color-accent) 80%, black)
    );
    border-color: var(--color-accent);
    color: #ffffff;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }

  .btn.active:hover:not(:disabled) {
    background: linear-gradient(
      180deg,
      var(--color-accent-hi),
      var(--color-accent)
    );
    border-color: var(--color-accent-hi);
  }

  .btn.warning.active {
    background: linear-gradient(
      180deg,
      var(--color-warning),
      color-mix(in srgb, var(--color-warning) 80%, black)
    );
    border-color: var(--color-warning);
    color: #ffffff;
  }

  .btn.warning.active:hover:not(:disabled) {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-warning) 70%, white),
      var(--color-warning)
    );
    color: #ffffff;
  }

  .btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: -3px;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
