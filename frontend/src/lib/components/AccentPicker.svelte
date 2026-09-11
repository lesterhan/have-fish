<script lang="ts">
  import { copy } from '$lib/copy'
  import { ACCENTS } from '$lib/accent'
  import type { AccentKey } from '$lib/accent'
  import { tooltip as tooltipAction } from '$lib/tooltip'
  import { theme } from '$lib/theme.svelte'

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

<div class="picker" role="dialog" aria-label={copy.case.accent.picker}>
  <div class="grid">
    {#each Object.keys(ACCENTS) as key (key)}
      {@const a = ACCENTS[key as AccentKey][theme.dark ? 'dark' : 'light']}
      {@const active = key === current}
      <button
        class="swatch"
        class:active
        style="background: linear-gradient(180deg, {a.hi}, {a.hex})"
        aria-label={LABELS[key as AccentKey]}
        aria-pressed={active}
        use:tooltipAction={{ label: LABELS[key as AccentKey], always: true }}
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
    padding: var(--sp-xs);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 20px);
    gap: var(--sp-3xs);
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

  /* An inset ring rather than a thicker border: a 2px border shrinks the swatch's colour
     area by a pixel a side, so selecting one made it jog. */
  .swatch.active {
    box-shadow: inset 0 0 0 2px var(--color-text);
  }

  .check {
    font-size: var(--text-control);
    font-weight: var(--weight-bold);
    color: var(--color-accent-fg);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    line-height: var(--leading-none);
  }
</style>
