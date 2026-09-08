<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import { progressLabel, progressPercent } from './hub'

  interface Props {
    current: number
    tracked: number
  }

  let { current, tracked }: Props = $props()

  let percent = $derived(progressPercent(current, tracked))
  let complete = $derived(tracked === 0 || current === tracked)
</script>

<div class="progress" class:complete>
  <div class="row">
    <span class="label">
      {#if complete}
        <span class="check"><Icon name="check" size={12} /></span>
      {/if}
      {progressLabel(current, tracked)}
    </span>
    {#if !complete}
      <span class="count">{current}/{tracked}</span>
    {/if}
  </div>

  <div
    class="track"
    role="progressbar"
    aria-valuenow={percent}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={progressLabel(current, tracked)}
  >
    <div class="fill" style="width: {percent}%"></div>
  </div>
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-sm);
  }

  .label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-sans);
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .count {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* The one bit of celebration the epic allows: a small Aqua-gloss check, no confetti. */
  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-success) 55%, white),
      var(--color-success)
    );
    box-shadow: var(--shadow-control);
    color: var(--color-window-inset);
  }

  .track {
    height: 12px;
    background: var(--color-window-inset);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-inset);
    overflow: hidden;
  }

  /* Bar ink, not accent. This is a magnitude mark — its length reports how many accounts are
     current — and the accent means "the one live thing on this screen", which on this page is
     the account you are being asked to deal with, not the readout of how far along you are.
     Filled with the accent it was also the loudest thing here, above the work itself.

     The trough above is `--color-window-inset`, the ground every magnitude mark in the app is
     measured against; `tokens.test.ts` states that contract once for all of them. */
  .fill {
    height: 100%;
    border-radius: var(--radius-pill);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-bar-ink) 78%, white),
      var(--color-bar-ink)
    );
    /* Aqua's signature: a gloss highlight over the top half of the fill. */
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 6px 6px -6px rgba(255, 255, 255, 0.7);
    transition: width var(--duration-normal) var(--ease);
  }

  /* The exception, and the only one: finishing is the celebration P8 allows at the end of the
     loop. Green here is a status, not a quantity — the bar is full by definition. */
  .progress.complete .fill {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-success) 55%, white),
      var(--color-success)
    );
  }
</style>
