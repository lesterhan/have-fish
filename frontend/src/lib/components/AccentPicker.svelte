<script lang="ts">
  import { ACCENTS } from '$lib/accent'
  import type { AccentKey } from '$lib/accent'

  interface Props {
    current: AccentKey
    onselect: (key: AccentKey) => void
    onclose: () => void
  }

  let { current, onselect, onclose }: Props = $props()

  const LABELS: Record<AccentKey, string> = {
    aqua: 'Aqua',
    sage: 'Sage',
    persimmon: 'Persimmon',
    plum: 'Plum',
    ochre: 'Ochre',
    slate: 'Slate',
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Click-outside backdrop -->
<div class="backdrop" role="presentation" onclick={onclose}></div>

<div class="picker" role="dialog" aria-label="Choose accent color">
  <div class="grid">
    {#each Object.keys(ACCENTS) as key (key)}
      {@const a = ACCENTS[key as AccentKey].light}
      {@const active = key === current}
      <button
        class="swatch"
        class:active
        style="background: linear-gradient(180deg, {a.hi}, {a.hex})"
        title={LABELS[key as AccentKey]}
        aria-pressed={active}
        onclick={() => onselect(key as AccentKey)}
      >
        {#if active}<span class="check" aria-hidden="true">✓</span>{/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 499;
  }

  .picker {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 500;
    background: var(--color-window);
    border: 1px solid var(--color-sidebar-border);
    box-shadow: var(--shadow-raised);
    padding: var(--sp-xs);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 20px);
    gap: 4px;
  }

  .swatch {
    width: 20px;
    height: 20px;
    border: 1px solid rgba(0, 0, 0, 0.25);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: filter var(--duration-fast) var(--ease);
  }

  .swatch:hover {
    filter: brightness(1.15);
  }

  .swatch.active {
    border: 2px solid var(--color-text);
  }

  .check {
    font-size: 11px;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    line-height: 1;
  }
</style>
