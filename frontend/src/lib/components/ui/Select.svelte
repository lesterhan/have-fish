<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements'
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  interface Props extends HTMLSelectAttributes {
    value?: string
    children: Snippet
  }

  let {
    value = $bindable(''),
    children,
    class: className = '',
    ...restProps
  }: Props = $props()
</script>

<!-- The shell exists so the chevron can be a real element: <select> takes no
     children or pseudo-elements, and Icon paints its mask with currentColor,
     which a background-image data URI cannot do. Sizing classes go on the
     shell, since the select fills it. -->
<span class="select-shell {className}">
  <select class="select-input" bind:value {...restProps}>
    {@render children()}
  </select>
  <span class="select-tail"><Icon name="chevron-down-line" size={9} /></span>
</span>

<style>
  .select-shell {
    position: relative;
    display: inline-flex;
    color: var(--color-text-muted); /* inherited by the chevron mask */
  }

  /* An Aqua pop-up menu, not a text field: it is a chooser, so it wears the
     raised GradientButton skin rather than TextInput's inset trough. Metrics
     (height, radius, type, gradient) are kept in step with `.btn` in
     GradientButton.svelte so the two sit level in a ControlBar. */
  .select-input {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    height: 24px;
    box-sizing: border-box;
    padding: 0 24px 0 8px; /* right gutter reserves the tail */
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: var(--color-text);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-control);
    cursor: pointer;
    outline: none;

    /* Two layers: the 1px seam that seperates the tail, over the button
       gradient. Both are token-driven, so neither needs a per-theme copy. */
    background-image:
      linear-gradient(var(--color-rule), var(--color-rule)),
      linear-gradient(
        180deg,
        var(--color-btn-gradient-hi),
        var(--color-rule-soft)
      );
    background-repeat: no-repeat;
    background-position:
      right 20px center,
      0 0;
    background-size:
      1px 14px,
      100% 100%;

    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  /* Sits over the select, so clicks have to fall through to it. */
  .select-tail {
    position: absolute;
    top: 50%;
    right: 6px;
    display: inline-flex;
    translate: 0 -50%;
    pointer-events: none;
  }

  .select-input:hover:not(:disabled) {
    border-color: var(--color-accent-mid);
  }

  .select-input:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 1px;
  }

  .select-input:disabled {
    color: var(--color-text-disabled);
    box-shadow: none;
    cursor: not-allowed;
  }

  .select-shell:has(.select-input:disabled) {
    color: var(--color-text-disabled);
  }

  /* The popup list itself is drawn by the OS and cannot be styled to match
     MoreMenu; setting the option colours is the most that carries over, and it
     keeps the list legible under the dark theme. */
  .select-input :global(option) {
    background: var(--color-window);
    color: var(--color-text);
    font-weight: normal;
  }
</style>
