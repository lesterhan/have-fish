<script lang="ts">
  interface Props {
    checked?: boolean
    label?: string
    disabled?: boolean
  }

  let { checked = $bindable(false), label, disabled = false }: Props = $props()
</script>

<label class="toggle-wrap" class:disabled>
  <input type="checkbox" class="toggle-input" bind:checked {disabled} />
  <span class="track" class:on={checked}>
    <span class="thumb"></span>
  </span>
  {#if label}
    <span class="toggle-label">{label}</span>
  {/if}
</label>

<style>
  .toggle-wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    cursor: pointer;
    user-select: none;
    font-size: var(--text-xs);
  }

  .toggle-wrap.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* Hide the real checkbox but keep it accessible */
  .toggle-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  /* The pill track */
  .track {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 18px;
    border-radius: 9px;
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
    transition:
      background var(--duration-normal) var(--ease),
      box-shadow var(--duration-normal) var(--ease);
    flex-shrink: 0;
  }

  .track.on {
    background: var(--color-accent-mid);
    box-shadow:
      inset 1px 1px 0 #1a4fa0,
      inset -1px -1px 0 #6fa8e8;
  }

  /* The sliding thumb */
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-window-raised);
    box-shadow: var(--shadow-raised);
    transition: transform var(--duration-normal) var(--ease);
  }

  .track.on .thumb {
    transform: translateX(18px);
    background: var(--color-text-on-dark);
    box-shadow:
      inset 1px 1px 0 rgba(255, 255, 255, 0.6),
      inset -1px -1px 0 rgba(0, 0, 0, 0.25);
  }

  /* Focus ring on the track when the hidden input is focused */
  .toggle-input:focus-visible + .track {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 2px;
  }

  .toggle-label {
    color: var(--color-text);
  }
</style>
