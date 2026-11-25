<script lang="ts">
  // The days and currencies whose rate an amount guessed, each with a field for the rate I'd
  // give it. Enter writes it and closes; Escape, or a click away, closes with nothing written.
  import { onMount } from 'svelte'
  import { copy } from '../../../copy'
  import type { Guess } from '../../../shared/commands'
  import { wordsFor } from '../../ledger/refusals'
  import Field from '../../parts/Field.svelte'
  import { floating } from '../../parts/floating'
  import Popover from '../../parts/Popover.svelte'
  import { guessKey, guessLabel } from './report'

  type Props = {
    /** Each day and currency the amount guessed, once, by day then currency. */
    lines: Guess[]
    /** The figure clicked, which the popover hangs from. */
    anchor: HTMLElement
    /** Today, so a day of another year says its year. */
    today: string
    /** Closed, written or not. */
    onclose: () => void
  }
  let { lines, anchor, today, onclose }: Props = $props()

  let error = $state<{ key: string; words: string } | null>(null)
  let saving = $state(false)
  let layer: HTMLElement | undefined

  // The first field takes the cursor, so Enter writes without a click.
  onMount(() => layer?.querySelector<HTMLInputElement>('input')?.focus())

  /** Enter in a field: the rate typed there is written for that day and currency. */
  async function write(
    line: Guess,
    event: KeyboardEvent & { currentTarget: HTMLInputElement },
  ): Promise<void> {
    if (event.key !== 'Enter' || saving) return
    const key = guessKey(line)
    saving = true
    const written = await window.haveFish.invoke('rate.write', {
      date: line.date,
      currency: line.currency,
      rate: event.currentTarget.value,
    })
    saving = false
    if (!written.ok) {
      error = { key, words: wordsFor(written) }
      return
    }
    onclose()
  }

  /** Escape anywhere in it closes it, written or not. */
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose()
  }

  /** The cursor left for something outside it: a click away closes it too. */
  function focusout(event: FocusEvent & { currentTarget: HTMLElement }) {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    onclose()
  }
</script>

<div
  class="layer"
  role="dialog"
  aria-label={copy.reports.guesses.label}
  tabindex="-1"
  bind:this={layer}
  use:floating={anchor}
  onkeydown={keydown}
  onfocusout={focusout}
>
  <Popover>
    <ul>
      {#each lines as line (guessKey(line))}
        {@const id = `guess-${guessKey(line)}`}
        <li>
          <Field
            {id}
            label={guessLabel(line, today)}
            error={error?.key === guessKey(line) ? error.words : null}
            figures
          >
            {#snippet children(describedby)}
              <input
                {id}
                aria-describedby={describedby}
                autocomplete="off"
                spellcheck="false"
                onkeydown={(event) => write(line, event)}
              />
            {/snippet}
          </Field>
        </li>
      {/each}
    </ul>
  </Popover>
</div>

<style>
  /* Laid over what the figure sits in, as a path picker's options are; floating.ts places it. */
  .layer {
    position: absolute;
    inset-inline-start: 0;
    top: calc(100% + var(--space-1));
    z-index: 2;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    inline-size: max-content;
    min-inline-size: 100%;
    max-inline-size: min(24rem, 90vw);
    /* Shorter where the window has less room, on whichever side it opens. */
    max-height: min(14rem, var(--room, 14rem));
  }

  ul {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    list-style: none;
  }
</style>
