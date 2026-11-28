<script lang="ts">
  // The lines whose rate an amount guessed, each with a field for the rate I'd give it. Enter
  // writes it and closes; the nearest button writes every borrowed line; Fetch says what fetching
  // sends, and Allow this once fetches every guessed day behind the amount. A fetch that missed
  // some keeps only those lines, each with its reason. Escape, or a click away, closes.
  import { onDestroy, onMount, tick } from 'svelte'
  import { copy } from '../../../copy'
  import type { Guess, InputOf, Missed, Wire } from '../../../shared/commands'
  import { wordsFor } from '../../ledger/refusals'
  import Button from '../../parts/Button.svelte'
  import Field from '../../parts/Field.svelte'
  import Fold from '../../parts/Fold.svelte'
  import { floating } from '../../parts/floating'
  import Popover from '../../parts/Popover.svelte'
  import {
    askingLines,
    daysToAsk,
    guessKey,
    guessLabel,
    leftAfterOffer,
    missedOn,
    missedWords,
    nearestOf,
    offerOf,
    rateOf,
  } from './report'
  import { dismiss } from './dismiss'

  type Props = {
    /** The lines the amount guessed: a borrowed day and currency once, a missing currency once. */
    lines: Guess[]
    /** Every guessed day and currency behind the amount, each once: what a fetch asks for. */
    days: InputOf<'rate.fetch'>['days']
    /** The figure clicked, which the popover hangs from. */
    anchor: HTMLElement
    /** Today, so a day of another year says its year. */
    today: string
    /** Closed, written or not; `back` when the cursor goes back to the tree. */
    onclose: (back: boolean) => void
  }
  let { lines, days, anchor, today, onclose }: Props = $props()

  let error = $state<{ key: string; words: string } | null>(null)
  let saving = $state(false)
  let allow = $state<Button>()
  /** Every day a fetch missed, each once, or null before one has answered. */
  let left = $state<Missed[] | null>(null)
  let layer: HTMLElement | undefined
  // Set as it goes: a write's answer that comes back now has no popover to close.
  let gone = false

  /** The lines still asking: every one before a fetch, then only those a fetch missed. */
  const shown = $derived(askingLines(lines, left, days))

  /** The borrowed lines' rates, as typed rates: what the button writes, in one go. */
  const nearest = $derived(nearestOf(shown))

  // The first field takes the cursor, so Enter writes without a click.
  onMount(() => layer?.querySelector<HTMLInputElement>('input')?.focus())
  onDestroy(() => {
    gone = true
  })

  /** Sends one call; a fetch's `rest` is what it leaves, and the popover closes at nothing. */
  async function send<T>(
    key: string,
    call: () => Promise<Wire<T>>,
    rest?: (value: T) => Missed[],
  ): Promise<void> {
    if (saving) return
    saving = true
    const answered = await call()
    if (gone) return
    if (!answered.ok) {
      saving = false
      error = { key, words: wordsFor(answered) }
      // Disabled while it waited, Allow lost the cursor: a refusal gives it back, so Esc closes.
      if (rest !== undefined) {
        await tick()
        allow?.focus()
      }
      return
    }
    error = null
    const kept = rest === undefined ? [] : rest(answered.value)
    if (kept.length === 0) {
      saving = false
      onclose(true)
      return
    }
    left = kept
    await tick()
    layer?.querySelector<HTMLInputElement>('input')?.focus()
    saving = false
  }

  /** Enter in a field: the rate typed there is written for that day and currency. */
  async function write(line: Guess, event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key !== 'Enter') return
    const rate = event.currentTarget.value
    await send(guessKey(line), () => window.haveFish.invoke('rate.write', rateOf(line, rate)))
  }

  /** The rates used here as typed rates, in one go: what the field holds isn't read. */
  async function useNearest(): Promise<void> {
    const [first] = nearest
    if (first === undefined) return
    await send(guessKey(first), () => window.haveFish.invoke('rate.writeAll', { rates: nearest }))
  }

  /** Allow this once: the published rate for every guessed day behind the amount, fetched now. */
  async function fetchOnce(): Promise<void> {
    const [first] = shown
    if (first === undefined) return
    const ask = { days: daysToAsk(left, days) }
    await send(guessKey(first), () => window.haveFish.invoke('rate.fetch', ask), (v) => v.missed)
  }

  /** Use it under a line: the last rate before its days, fetched as the service published it. */
  async function useOffer(line: Guess, missed: readonly Missed[]): Promise<void> {
    const offered = offerOf(missed)
    if (offered.length === 0) return
    await send(
      guessKey(line),
      () => window.haveFish.invoke('rate.fetch', { days: offered, last: true }),
      (value) => leftAfterOffer(left ?? [], offered, value.missed),
    )
  }
</script>

<div
  class="layer"
  role="dialog"
  aria-label={copy.reports.guesses.label}
  tabindex="-1"
  bind:this={layer}
  use:floating={anchor}
  use:dismiss={{ waiting: () => saving, onclose }}
>
  <Popover>
    <div class="body">
      <ul>
        {#each shown as line (guessKey(line))}
          {@const key = guessKey(line)}
          {@const missed = missedOn(line, left, days)}
          {@const words = missed.length === 0 ? null : missedWords(missed, today)}
          <li>
            <Field
              id={`guess-${key}`}
              label={guessLabel(line, today)}
              error={error?.key === key ? error.words : words}
              figures
            >
              {#snippet children(describedby)}
                <input
                  id={`guess-${key}`}
                  aria-describedby={describedby}
                  autocomplete="off"
                  spellcheck="false"
                  onkeydown={(event) => write(line, event)}
                />
              {/snippet}
            </Field>
            {#if offerOf(missed).length > 0}
              <Button onclick={() => useOffer(line, missed)} disabled={saving}
                >{copy.reports.fetch.use}</Button
              >
            {/if}
          </li>
        {/each}
      </ul>
      <div class="foot">
        {#if nearest.length > 0}
          <Button onclick={useNearest}>{copy.reports.guesses.nearest}</Button>
        {/if}
        <Fold summary={copy.reports.fetch.open}>
          <p>{copy.reports.fetch.sends}</p>
          <Button bind:this={allow} onclick={fetchOnce} disabled={saving}
            >{copy.reports.fetch.once}</Button
          >
        </Fold>
      </div>
    </div>
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

  .body {
    overflow-y: auto;
    min-block-size: 0;
  }

  ul {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    list-style: none;
  }

  li {
    display: grid;
    gap: var(--space-1);
  }

  .foot {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  p {
    margin: 0;
  }
</style>
