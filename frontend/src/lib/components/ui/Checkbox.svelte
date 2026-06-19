<script lang="ts">
  import Icon from './Icon.svelte'

  interface Props {
    checked?: boolean
    disabled?: boolean
    label?: string
    ariaLabel?: string
    size?: number
    onchange?: (checked: boolean) => void
  }

  let {
    checked = $bindable(false),
    disabled = false,
    label,
    ariaLabel,
    size = 16,
    onchange,
  }: Props = $props()
</script>

<label class="cb-wrap" class:disabled>
  <input
    type="checkbox"
    class="cb-input"
    bind:checked
    {disabled}
    aria-label={ariaLabel}
    onchange={() => onchange?.(checked)}
  />
  <span class="cb-box" class:checked style="--cb-size: {size}px">
    {#if checked}<Icon name="check" size={Math.round(size * 0.68)} />{/if}
  </span>
  {#if label}<span class="cb-label">{label}</span>{/if}
</label>

<style>
  /* Aqua-style checkbox: glossy raised square, accent-gradient fill + white tick when
     checked. Sharp-ish corners (2px) per the design system. */
  .cb-wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    cursor: pointer;
    user-select: none;
    font-size: var(--text-sm);
  }

  .cb-wrap.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* Hide the real checkbox but keep it accessible/focusable. */
  .cb-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .cb-box {
    width: var(--cb-size);
    height: var(--cb-size);
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-rule);
    background: linear-gradient(180deg, #ffffff, #dfe2e7);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.7),
      0 1px 1px rgba(0, 0, 0, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .cb-box.checked {
    background: linear-gradient(180deg, var(--color-accent-hi), var(--color-accent));
    border-color: var(--color-accent);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.45),
      0 1px 1px rgba(0, 0, 0, 0.15);
  }

  .cb-wrap:hover .cb-box {
    border-color: var(--color-accent-mid);
  }

  .cb-input:focus-visible + .cb-box {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 1px;
  }

  .cb-label {
    color: var(--color-text);
  }
</style>
