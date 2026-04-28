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
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    transition:
      background var(--duration-normal) var(--ease),
      border-color var(--duration-normal) var(--ease);
    flex-shrink: 0;
  }

  .track.on {
    background: linear-gradient(180deg, var(--color-accent-hi), var(--color-accent));
    border-color: var(--color-accent);
  }

  /* The sliding thumb */
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: linear-gradient(180deg, #ffffff, #e8eaed);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    transition: transform var(--duration-normal) var(--ease);
  }

  .track.on .thumb {
    transform: translateX(18px);
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
