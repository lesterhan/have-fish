<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import type { ImportStep } from '$lib/import-session'

  interface Props {
    step: ImportStep
    // Steps in flow order, listing only the ones that exist. Later stories in this epic
    // add their own segments — a stepper advertising a step that isn't built reads as a
    // broken flow rather than an unfinished one.
    steps: { id: ImportStep; label: string }[]
    onnavigate: (step: ImportStep) => void
  }

  let { step, steps, onnavigate }: Props = $props()

  let currentIndex = $derived(steps.findIndex((s) => s.id === step))
</script>

<nav class="stepper" aria-label="Import progress">
  {#each steps as s, i (s.id)}
    {#if i > 0}
      <span class="separator" aria-hidden="true">
        <Icon name="chevron-right-filled" size={9} />
      </span>
    {/if}
    <button
      type="button"
      class="segment"
      class:done={i < currentIndex}
      class:current={i === currentIndex}
      disabled={i >= currentIndex}
      aria-current={i === currentIndex ? 'step' : undefined}
      onclick={() => onnavigate(s.id)}
    >
      <span class="marker">
        {#if i < currentIndex}
          <Icon name="check" size={9} />
        {:else}
          {i + 1}
        {/if}
      </span>
      <span class="label">{s.label}</span>
    </button>
  {/each}
</nav>

<style>
  /* Sits in the same section bar as the Import/Export tabs, so it borrows their
     typographic treatment — the two must not read as different kinds of control. */
  .stepper {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .separator {
    display: inline-flex;
    align-items: center;
    color: var(--color-text-muted);
  }

  .segment {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    transition: color var(--duration-fast) var(--ease);
  }

  /* Only a completed step is clickable — a later one has nothing to show yet. */
  .segment:disabled {
    cursor: default;
  }

  .segment.done {
    cursor: pointer;
  }

  .segment.done:hover {
    color: var(--color-text);
  }

  .segment:focus-visible {
    outline: 2px solid var(--color-accent-hi);
    outline-offset: -2px;
  }

  .segment.current {
    color: var(--color-accent);
  }

  /* A step you have not reached, and a step you have finished, are both neutral. The accent
     marks where you *are* — on the Review step there were four accent chips behind the one
     that mattered, and a stepper whose finished steps are as loud as the current one is a
     progress indicator that does not indicate progress. */
  .marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: var(--radius-pill);
    background: var(--color-window-raised);
    color: var(--color-text-muted);
    box-shadow: inset 0 0 0 1px var(--color-rule);
    font-size: 9px;
    line-height: 1;
  }

  .segment.done .marker {
    color: var(--color-text);
  }

  .segment.current .marker {
    background: var(--color-accent);
    color: var(--color-accent-fg);
    box-shadow: none;
  }
</style>
