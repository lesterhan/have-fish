<script lang="ts">
  // The lines whose rate an amount guessed, each with a field for the rate I'd give it. Enter
  // writes it and closes; the button writes every borrowed line at the figures shown; Fetch
  // says what fetching sends, and Allow this once fetches every guessed day behind the amount.
  // Escape, or a click away, closes with nothing written.
  import { onDestroy, onMount } from 'svelte'
  import { copy } from '../../../copy'
  import type { Guess, InputOf, Wire } from '../../../shared/commands'
  import { wordsFor } from '../../ledger/refusals'
  import Button from '../../parts/Button.svelte'
  import Field from '../../parts/Field.svelte'
  import Fold from '../../parts/Fold.svelte'
  import { floating } from '../../parts/floating'
  import Popover from '../../parts/Popover.svelte'
  import { guessKey, guessLabel, nearestOf } from './report'

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
  let layer: HTMLElement | undefined
  // Set as it goes: a write's answer that comes back now has no popover to close.
  let gone = false

  /** The borrowed lines' rates, as typed rates: what the button writes, in one go. */
  const nearest = $derived(nearestOf(lines))

  // The first field takes the cursor, so Enter writes without a click.
  onMount(() => layer?.querySelector<HTMLInputElement>('input')?.focus())
  onDestroy(() => {
    gone = true
  })

  /** Sends one write: refused, its words go under `key`'s field; else the popover closes. */
  async function send(key: string, call: () => Promise<Wire<unknown>>): Promise<void> {
    if (saving) return
    saving = true
    const answered = await call()
    if (gone) return
    saving = false
    if (!answered.ok) {
      error = { key, words: wordsFor(answered) }
      return
    }
    onclose(true)
  }

  /** Enter in a field: the rate typed there is written for that day and currency. */
  async function write(
    line: Guess,
    event: KeyboardEvent & { currentTarget: HTMLInputElement },
  ): Promise<void> {
    if (event.key !== 'Enter') return
    await send(guessKey(line), () =>
      window.haveFish.invoke('rate.write', {
        date: line.date,
        currency: line.currency,
        rate: event.currentTarget.value,
      }),
    )
  }

  /** The rates used here as typed rates, in one go: what the field holds isn't read. */
  async function useNearest(): Promise<void> {
    const first = nearest[0]
    if (first === undefined) return
    await send(guessKey(first), () => window.haveFish.invoke('rate.writeAll', { rates: nearest }))
  }

  /** Allow this once: the published rate for every guessed day behind the amount, fetched now. */
  async function fetchOnce(): Promise<void> {
    const first = lines[0]
    if (first === undefined) return
    await send(guessKey(first), () => window.haveFish.invoke('rate.fetch', { days }))
  }

  /** Escape anywhere in it closes it, written or not. */
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose(true)
  }

  /**
   * The cursor left it: a click on another control keeps the cursor there, one on nothing gives
   * the tree the cursor, and a window that lost it keeps the popover as it was.
   */
  function focusout(event: FocusEvent & { currentTarget: HTMLElement }) {
    if (!document.hasFocus()) return
    // Allow disabled while it had the cursor blurs by itself: that is not a click away.
    if (saving && event.target instanceof HTMLElement && event.target.matches(':disabled')) return
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    onclose(next === null)
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
    <div class="body">
      <ul>
        {#each lines as line (guessKey(line))}
          {@const key = guessKey(line)}
          <li>
            <Field
              id={`guess-${key}`}
              label={guessLabel(line, today)}
              error={error?.key === key ? error.words : null}
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
          </li>
        {/each}
      </ul>
      <div class="foot">
        {#if nearest.length > 0}
          <Button onclick={useNearest}>{copy.reports.guesses.nearest}</Button>
        {/if}
        <Fold summary={copy.reports.fetch.open}>
          <p>{copy.reports.fetch.sends}</p>
          <Button onclick={fetchOnce} disabled={saving}>{copy.reports.fetch.once}</Button>
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

  .foot {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  p {
    margin: 0;
  }
</style>
