<script lang="ts">
  // This computer's own settings: whether a fetch may look rates up, and nothing the ledger holds.
  import { copy } from '../../../copy'
  import { wordsFor } from '../../ledger/refusals'
  import Field from '../../parts/Field.svelte'
  import Header from '../../parts/Header.svelte'
  import Notice from '../../parts/Notice.svelte'

  type Props = { hidden: boolean }
  let { hidden }: Props = $props()

  /** What main kept: off until it is turned on, and anything it can't read is off. */
  let lookUp = $state(false)
  /** Why a set was refused, until I put it away. */
  let error = $state<string | null>(null)
  let box: HTMLInputElement | undefined

  // Asked each time it shows, so the switch is this computer's, as main keeps it.
  $effect(() => {
    if (hidden) return
    void ask()
  })

  /** Whether main keeps this computer looking rates up. */
  async function ask(): Promise<void> {
    const asked = await window.haveFish.invoke('settings.rates.get', {})
    if (asked.ok) lookUp = asked.value.on
  }

  /** Sets it, then shows what main kept; a refusal says why and puts the box back. */
  async function change(event: Event & { currentTarget: HTMLInputElement }) {
    const asked = await window.haveFish.invoke('settings.rates.set', {
      on: event.currentTarget.checked,
    })
    if (!asked.ok) {
      error = wordsFor(asked)
      event.currentTarget.checked = lookUp
      return
    }
    error = null
    lookUp = asked.value.on
  }

  function dismiss() {
    error = null
  }

  /** Coming here from another place: the switch. */
  export function focus() {
    box?.focus()
  }

  /** Nothing here to select: an undo never shows Settings. */
  export function show(_id: string): Promise<void> {
    return Promise.resolve()
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    error = words
  }
</script>

<main class="settings" {hidden}>
  <div class="top">
    <Header title={copy.settings.title} line={copy.settings.line} />
    {#if error}<Notice words={error} ondismiss={dismiss} />{/if}
  </div>
  <Field id="settings-rates" label={copy.settings.rates}>
    {#snippet note()}{copy.reports.fetch.sends}{/snippet}
    {#snippet children(describedby)}
      <input
        id="settings-rates"
        type="checkbox"
        role="switch"
        aria-describedby={describedby}
        checked={lookUp}
        onchange={change}
        bind:this={box}
      />
    {/snippet}
  </Field>
</main>

<style>
  main {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    align-content: start;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  main[hidden] {
    display: none;
  }

  .top {
    display: grid;
    gap: var(--space-3);
  }
</style>
