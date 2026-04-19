<script lang="ts">
  import { tooltip } from '$lib/tooltip'

  interface Props {
    label: string
  }

  let { label }: Props = $props()
</script>

<button
  type="button"
  class="tooltip-icon"
  use:tooltip={label}
  aria-label={label}>?</button
>

<style>
  .tooltip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-text-muted);
    color: var(--color-window);
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: bold;
    line-height: 1;
    padding: 0;
    border: none;
    cursor: help;
    flex-shrink: 0;
  }
</style>
