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
  import { guessKey, guessLabel, lineDays, missedWords, nearestOf, offerOf } from './report'

  type Props = {
    lines: Guess[]
    days: InputOf<'rate.fetch'>['days']
    anchor: HTMLElement
    today: string
    onclose: (back: boolean) => void
  }
  let { lines, days, anchor, today, onclose }: Props = $props()

  let error = $state<{ key: string; words: string } | null>(null)
  let saving = $state(false)
  let allow = $state<Button>()
  let left = $state<Missed[] | null>(null)
  let layer: HTMLElement | undefined
  let gone = false

  const nearest = $derived(nearestOf(lines))

  function missedOf(line: Guess): Missed[] {
    const mine = lineDays(line, days).map(guessKey)
    return (left ?? []).filter((one) => mine.includes(guessKey(one)))
  }

  const shown = $derived(left === null ? lines : lines.filter((one) => missedOf(one).length > 0))

  const toAsk = (): InputOf<'rate.fetch'>['days'] =>
    left === null ? days : left.map((one) => ({ date: one.date, currency: one.currency }))

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
  ): Promise<boolean> {
    if (saving) return false
    saving = true
    const answered = await call()
    if (gone) return false
    if (!answered.ok) {
      saving = false
      error = { key, words: wordsFor(answered) }
      return true
    }
    const kept = rest === undefined ? [] : rest(answered.value)
    if (kept.length === 0) {
      saving = false
      onclose(true)
      return false
    }
    left = kept
    await tick()
    layer?.querySelector<HTMLInputElement>('input')?.focus()
    saving = false
    return false
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
    const refused = await send(
      guessKey(first),
      () => window.haveFish.invoke('rate.fetch', { days: toAsk() }),
      (value) => value.missed,
    )
    if (gone || !refused) return
    await tick()
    allow?.focus()
  }

  /** Use it under a line: the last rate before its days, fetched as the service published it. */
  async function useOffer(line: Guess): Promise<void> {
    const offered = offerOf(missedOf(line))
    if (offered.length === 0) return
    const rest = (value: { missed: Missed[] }): Missed[] => [
      ...(left ?? []).filter((one) => !offered.some((day) => guessKey(day) === guessKey(one))),
      ...value.missed,
    ]
    await send(
      guessKey(line),
      () => window.haveFish.invoke('rate.fetch', { days: offered, last: true }),
      rest,
    )
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
    // An answer may take a control away, or disable the one with the cursor: not a click away.
    if (saving) return
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
        {#each shown as line (guessKey(line))}
          {@const key = guessKey(line)}
          {@const missed = missedOf(line)}
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
              <Button onclick={() => useOffer(line)} disabled={saving}
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
